package protocol

import (
	"bytes"
	"encoding/binary"
	"strings"
	"testing"
)

type chunkReader struct {
	data      []byte
	chunkSize int
}

func (reader *chunkReader) Read(target []byte) (int, error) {
	if len(reader.data) == 0 {
		return 0, nil
	}
	count := reader.chunkSize
	if count > len(reader.data) {
		count = len(reader.data)
	}
	if count > len(target) {
		count = len(target)
	}
	copy(target, reader.data[:count])
	reader.data = reader.data[count:]
	return count, nil
}

func TestReadHandlesFragmentedFrame(t *testing.T) {
	original := NewMessage("chat", "甲", "乙", "你好，TCP")
	var encoded bytes.Buffer
	if err := Write(&encoded, original); err != nil {
		t.Fatalf("Write() error = %v", err)
	}

	reader := &chunkReader{data: encoded.Bytes(), chunkSize: 1}
	decoded, err := Read(reader)
	if err != nil {
		t.Fatalf("Read() error = %v", err)
	}
	if decoded != original {
		t.Fatalf("decoded message = %#v, want %#v", decoded, original)
	}
}

func TestReadSeparatesBackToBackFrames(t *testing.T) {
	first := NewMessage("chat", "alice", "bob", "first")
	second := NewMessage("chat", "bob", "alice", "second")
	var stream bytes.Buffer
	if err := Write(&stream, first); err != nil {
		t.Fatal(err)
	}
	if err := Write(&stream, second); err != nil {
		t.Fatal(err)
	}

	gotFirst, err := Read(&stream)
	if err != nil {
		t.Fatal(err)
	}
	gotSecond, err := Read(&stream)
	if err != nil {
		t.Fatal(err)
	}
	if gotFirst != first || gotSecond != second {
		t.Fatalf("messages were not separated correctly: %#v %#v", gotFirst, gotSecond)
	}
}

func TestContentLengthUsesUTF8Bytes(t *testing.T) {
	message := NewMessage("chat", "alice", "bob", "你好")
	if message.ContentLength != 6 {
		t.Fatalf("ContentLength = %d, want 6", message.ContentLength)
	}
	message.ContentLength = 2
	if err := Write(&bytes.Buffer{}, message); err == nil {
		t.Fatal("Write() accepted a Unicode character count instead of UTF-8 byte length")
	}
}

func TestReadRejectsOversizedFrame(t *testing.T) {
	header := make([]byte, 4)
	binary.BigEndian.PutUint32(header, MaxFrameSize+1)
	_, err := Read(bytes.NewReader(header))
	if err == nil || !strings.Contains(err.Error(), "invalid frame body length") {
		t.Fatalf("Read() error = %v, want oversized-frame error", err)
	}
}
