package chatserver

import (
	"io"
	"log"
	"net"
	"testing"
	"time"

	"a3chat/internal/protocol"
)

func TestServerRegistrationAndPrivateChat(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server := New(log.New(io.Discard, "", 0))
	serverDone := make(chan error, 1)
	go func() {
		serverDone <- server.Serve(listener)
	}()
	defer func() {
		_ = listener.Close()
		select {
		case err := <-serverDone:
			if err != nil {
				t.Errorf("Serve() error = %v", err)
			}
		case <-time.After(time.Second):
			t.Error("server did not stop after listener was closed")
		}
	}()

	alice := registerClient(t, listener.Addr().String(), "alice")
	defer alice.Close()
	bob := registerClient(t, listener.Addr().String(), "bob")
	defer bob.Close()

	duplicate, err := net.Dial("tcp", listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer duplicate.Close()
	if err := protocol.Write(duplicate, protocol.NewMessage("register", "alice", "server", "")); err != nil {
		t.Fatal(err)
	}
	duplicateReply := readWithDeadline(t, duplicate)
	if duplicateReply.Type != "error" {
		t.Fatalf("duplicate registration reply type = %q, want error", duplicateReply.Type)
	}

	content := "你好，Bob"
	if err := protocol.Write(alice, protocol.NewMessage("chat", "alice", "bob", content)); err != nil {
		t.Fatal(err)
	}
	forwarded := readWithDeadline(t, bob)
	if forwarded.Type != "chat" || forwarded.Sender != "alice" || forwarded.Content != content {
		t.Fatalf("forwarded message = %#v", forwarded)
	}
	delivered := readWithDeadline(t, alice)
	if delivered.Type != "delivered" {
		t.Fatalf("sender reply type = %q, want delivered", delivered.Type)
	}

	if err := protocol.Write(bob, protocol.NewMessage("chat", "bob", "alice", "收到")); err != nil {
		t.Fatal(err)
	}
	reply := readWithDeadline(t, alice)
	if reply.Type != "chat" || reply.Sender != "bob" || reply.Content != "收到" {
		t.Fatalf("reply message = %#v", reply)
	}
	if ack := readWithDeadline(t, bob); ack.Type != "delivered" {
		t.Fatalf("reply acknowledgement type = %q, want delivered", ack.Type)
	}

	if err := protocol.Write(alice, protocol.NewMessage("chat", "alice", "nobody", "test")); err != nil {
		t.Fatal(err)
	}
	missingUser := readWithDeadline(t, alice)
	if missingUser.Type != "error" {
		t.Fatalf("missing-user reply type = %q, want error", missingUser.Type)
	}
}

func registerClient(t *testing.T, address, name string) net.Conn {
	t.Helper()
	connection, err := net.Dial("tcp", address)
	if err != nil {
		t.Fatal(err)
	}
	if err := protocol.Write(connection, protocol.NewMessage("register", name, "server", "")); err != nil {
		connection.Close()
		t.Fatal(err)
	}
	reply := readWithDeadline(t, connection)
	if reply.Type != "register_ack" {
		connection.Close()
		t.Fatalf("registration reply = %#v", reply)
	}
	return connection
}

func readWithDeadline(t *testing.T, connection net.Conn) protocol.Message {
	t.Helper()
	if err := connection.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
		t.Fatal(err)
	}
	message, err := protocol.Read(connection)
	if err != nil {
		t.Fatal(err)
	}
	if err := connection.SetReadDeadline(time.Time{}); err != nil {
		t.Fatal(err)
	}
	return message
}
