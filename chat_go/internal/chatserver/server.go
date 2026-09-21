package chatserver

import (
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"a3chat/internal/protocol"
)

const (
	registrationTimeout = 10 * time.Second
	maxUsernameRunes    = 32
	maxChatContentBytes = 64 * 1024
)

type client struct {
	name   string
	conn   net.Conn
	sendMu sync.Mutex
}

func (client *client) send(message protocol.Message) error {
	client.sendMu.Lock()
	defer client.sendMu.Unlock()
	return protocol.Write(client.conn, message)
}

type Server struct {
	mu      sync.RWMutex
	clients map[string]*client
	logger  *log.Logger
}

func New(logger *log.Logger) *Server {
	if logger == nil {
		logger = log.New(io.Discard, "", 0)
	}
	return &Server{
		clients: make(map[string]*client),
		logger:  logger,
	}
}

func (server *Server) Serve(listener net.Listener) error {
	for {
		connection, err := listener.Accept()
		if err != nil {
			if errors.Is(err, net.ErrClosed) {
				return nil
			}
			return fmt.Errorf("accept client: %w", err)
		}
		go server.handleConnection(connection)
	}
}

func (server *Server) handleConnection(connection net.Conn) {
	peer := connection.RemoteAddr().String()
	clientConnection := &client{conn: connection}
	if err := connection.SetReadDeadline(time.Now().Add(registrationTimeout)); err != nil {
		server.logger.Printf("设置注册超时失败 peer=%s error=%v", peer, err)
		_ = connection.Close()
		return
	}

	registration, err := protocol.Read(connection)
	if err != nil {
		server.logger.Printf("读取注册消息失败 peer=%s error=%v", peer, err)
		_ = connection.Close()
		return
	}
	if registration.Type != "register" {
		server.sendError(clientConnection, registration.Sender, "连接后的第一条消息必须是 register")
		_ = connection.Close()
		return
	}
	if err := validateUsername(registration.Sender); err != nil {
		server.sendError(clientConnection, registration.Sender, err.Error())
		_ = connection.Close()
		return
	}

	clientConnection.name = registration.Sender
	if !server.addClient(clientConnection) {
		server.sendError(clientConnection, registration.Sender, "用户名已在线，请更换用户名")
		_ = connection.Close()
		return
	}
	defer server.removeClient(clientConnection)
	_ = connection.SetReadDeadline(time.Time{})

	ack := protocol.NewMessage("register_ack", "server", clientConnection.name, "注册成功")
	if err := clientConnection.send(ack); err != nil {
		server.logger.Printf("发送注册确认失败 user=%s error=%v", clientConnection.name, err)
		return
	}
	server.logger.Printf("用户上线 user=%s peer=%s", clientConnection.name, peer)

	for {
		message, err := protocol.Read(connection)
		if err != nil {
			if !errors.Is(err, io.EOF) && !errors.Is(err, net.ErrClosed) {
				server.logger.Printf("客户端连接结束 user=%s error=%v", clientConnection.name, err)
			}
			return
		}
		server.handleMessage(clientConnection, message)
	}
}

func (server *Server) handleMessage(sender *client, message protocol.Message) {
	if message.Type != "chat" {
		server.sendError(sender, sender.name, "注册后只接受 chat 类型消息")
		return
	}
	if message.Sender != sender.name {
		server.sendError(sender, sender.name, "发送方必须与已注册用户名一致")
		return
	}
	if err := validateUsername(message.Receiver); err != nil {
		server.sendError(sender, sender.name, "接收方用户名无效")
		return
	}
	if message.ContentLength == 0 {
		server.sendError(sender, sender.name, "消息内容不能为空")
		return
	}
	if message.ContentLength > maxChatContentBytes {
		server.sendError(sender, sender.name, "消息内容不能超过 64 KiB")
		return
	}

	target := server.findClient(message.Receiver)
	if target == nil {
		server.sendError(sender, sender.name, "目标用户不存在或不在线")
		return
	}

	forwarded := protocol.NewMessage("chat", sender.name, target.name, message.Content)
	if err := target.send(forwarded); err != nil {
		server.removeClient(target)
		server.sendError(sender, sender.name, "消息发送失败，目标用户连接已断开")
		return
	}

	ackText := fmt.Sprintf("消息已送达 %s", target.name)
	if err := sender.send(protocol.NewMessage("delivered", "server", sender.name, ackText)); err != nil {
		server.logger.Printf("发送送达确认失败 user=%s error=%v", sender.name, err)
	}
	server.logger.Printf("消息转发 sender=%s receiver=%s bytes=%d", sender.name, target.name, message.ContentLength)
}

func (server *Server) addClient(newClient *client) bool {
	server.mu.Lock()
	defer server.mu.Unlock()
	if _, exists := server.clients[newClient.name]; exists {
		return false
	}
	server.clients[newClient.name] = newClient
	return true
}

func (server *Server) findClient(name string) *client {
	server.mu.RLock()
	defer server.mu.RUnlock()
	return server.clients[name]
}

func (server *Server) removeClient(disconnected *client) {
	server.mu.Lock()
	current, exists := server.clients[disconnected.name]
	if exists && current == disconnected {
		delete(server.clients, disconnected.name)
	}
	server.mu.Unlock()
	if exists && current == disconnected {
		_ = disconnected.conn.Close()
		server.logger.Printf("用户下线 user=%s", disconnected.name)
	}
}

func (server *Server) sendError(target *client, receiver, text string) {
	message := protocol.NewMessage("error", "server", receiver, text)
	if err := target.send(message); err != nil {
		server.logger.Printf("发送错误消息失败 receiver=%s error=%v", receiver, err)
	}
}

func validateUsername(name string) error {
	if !utf8.ValidString(name) {
		return errors.New("用户名必须是有效的 UTF-8 文本")
	}
	runeCount := utf8.RuneCountInString(name)
	if runeCount < 1 || runeCount > maxUsernameRunes {
		return fmt.Errorf("用户名长度必须为 1 到 %d 个字符", maxUsernameRunes)
	}
	for _, character := range name {
		if unicode.IsSpace(character) || unicode.IsControl(character) {
			return errors.New("用户名不能包含空白符或控制字符")
		}
	}
	return nil
}
