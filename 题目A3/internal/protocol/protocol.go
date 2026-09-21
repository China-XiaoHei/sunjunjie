package protocol

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

const MaxFrameSize = 1024 * 1024

type Message struct {
	Type          string `json:"type"`
	Sender        string `json:"sender"`
	Receiver      string `json:"receiver"`
	ContentLength int    `json:"contentLength"`
	Content       string `json:"content"`
}

func NewMessage(messageType, sender, receiver, content string) Message {
	return Message{
		Type:          messageType,
		Sender:        sender,
		Receiver:      receiver,
		ContentLength: len([]byte(content)),
		Content:       content,
	}
}

func Write(writer io.Writer, message Message) error {
	if err := validate(message); err != nil {
		return err
	}

	body, err := json.Marshal(message)
	if err != nil {
		return fmt.Errorf("encode message: %w", err)
	}
	if len(body) == 0 || len(body) > MaxFrameSize {
		return fmt.Errorf("message body size %d is outside the allowed range", len(body))
	}

	frame := make([]byte, 4+len(body))
	binary.BigEndian.PutUint32(frame[:4], uint32(len(body)))
	copy(frame[4:], body)
	return writeAll(writer, frame)
}

func Read(reader io.Reader) (Message, error) {
	var message Message
	header := make([]byte, 4)
	if _, err := io.ReadFull(reader, header); err != nil {
		return message, fmt.Errorf("read frame header: %w", err)
	}

	bodyLength := binary.BigEndian.Uint32(header)
	if bodyLength == 0 || bodyLength > MaxFrameSize {
		return message, fmt.Errorf("invalid frame body length: %d", bodyLength)
	}

	body := make([]byte, int(bodyLength))
	if _, err := io.ReadFull(reader, body); err != nil {
		return message, fmt.Errorf("read frame body: %w", err)
	}

	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&message); err != nil {
		return message, fmt.Errorf("decode message: %w", err)
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return message, errors.New("message body contains trailing JSON data")
	}
	if err := validate(message); err != nil {
		return message, err
	}
	return message, nil
}

func validate(message Message) error {
	if message.Type == "" {
		return errors.New("message type is required")
	}
	actualLength := len([]byte(message.Content))
	if message.ContentLength != actualLength {
		return fmt.Errorf(
			"contentLength is %d, but UTF-8 content uses %d bytes",
			message.ContentLength,
			actualLength,
		)
	}
	return nil
}

func writeAll(writer io.Writer, data []byte) error {
	for len(data) > 0 {
		written, err := writer.Write(data)
		if err != nil {
			return fmt.Errorf("write frame: %w", err)
		}
		if written == 0 {
			return io.ErrShortWrite
		}
		data = data[written:]
	}
	return nil
}
