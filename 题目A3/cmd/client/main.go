package main

import (
	"bufio"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"os"
	"strconv"
	"strings"
	"time"

	"a3chat/internal/protocol"
)

func main() {
	name := flag.String("name", "", "客户端用户名")
	host := flag.String("host", "127.0.0.1", "服务器地址")
	port := flag.Int("port", 9090, "服务器端口")
	flag.Parse()

	if strings.TrimSpace(*name) == "" {
		fmt.Fprintln(os.Stderr, "必须通过 -name 指定用户名")
		flag.Usage()
		os.Exit(2)
	}
	if *port < 1 || *port > 65535 {
		fmt.Fprintf(os.Stderr, "端口必须在 1 到 65535 之间，当前值：%d\n", *port)
		os.Exit(2)
	}

	address := net.JoinHostPort(*host, strconv.Itoa(*port))
	connection, err := net.DialTimeout("tcp", address, 5*time.Second)
	if err != nil {
		fmt.Fprintf(os.Stderr, "连接服务器 %s 失败：%v\n", address, err)
		os.Exit(1)
	}
	defer connection.Close()

	if err := register(connection, *name); err != nil {
		fmt.Fprintf(os.Stderr, "注册失败：%v\n", err)
		os.Exit(1)
	}
	fmt.Printf("已连接到 %s，当前用户名：%s\n", address, *name)
	printHelp()

	receiveDone := make(chan error, 1)
	go receiveMessages(connection, receiveDone)
	inputLines := readInputLines()

	for {
		select {
		case err := <-receiveDone:
			if err != nil && !errors.Is(err, io.EOF) && !errors.Is(err, net.ErrClosed) {
				fmt.Fprintf(os.Stderr, "与服务器的连接已断开：%v\n", err)
			}
			return
		case line, open := <-inputLines:
			if !open {
				return
			}
			line = strings.TrimSpace(line)
			switch {
			case line == "":
				continue
			case line == "/quit":
				fmt.Println("客户端已退出。")
				return
			case line == "/help":
				printHelp()
				continue
			}

			receiver, content, ok := parseChatCommand(line)
			if !ok {
				fmt.Println("命令格式错误，请使用：/msg <接收方> <消息内容>")
				continue
			}
			message := protocol.NewMessage("chat", *name, receiver, content)
			if err := protocol.Write(connection, message); err != nil {
				fmt.Fprintf(os.Stderr, "发送失败：%v\n", err)
				return
			}
		}
	}
}

func register(connection net.Conn, name string) error {
	if err := connection.SetDeadline(time.Now().Add(5 * time.Second)); err != nil {
		return err
	}
	defer connection.SetDeadline(time.Time{})

	request := protocol.NewMessage("register", name, "server", "")
	if err := protocol.Write(connection, request); err != nil {
		return err
	}
	reply, err := protocol.Read(connection)
	if err != nil {
		return err
	}
	switch reply.Type {
	case "register_ack":
		return nil
	case "error":
		return errors.New(reply.Content)
	default:
		return fmt.Errorf("收到未知注册响应：%s", reply.Type)
	}
}

func receiveMessages(connection net.Conn, done chan<- error) {
	for {
		message, err := protocol.Read(connection)
		if err != nil {
			done <- err
			return
		}
		switch message.Type {
		case "chat":
			fmt.Printf("\n[%s -> 你] %s\n", message.Sender, message.Content)
		case "delivered":
			fmt.Printf("[送达] %s\n", message.Content)
		case "error":
			fmt.Printf("[错误] %s\n", message.Content)
		default:
			fmt.Printf("[系统] 收到未知消息类型：%s\n", message.Type)
		}
	}
}

func readInputLines() <-chan string {
	lines := make(chan string)
	go func() {
		defer close(lines)
		scanner := bufio.NewScanner(os.Stdin)
		scanner.Buffer(make([]byte, 1024), protocol.MaxFrameSize)
		for scanner.Scan() {
			lines <- scanner.Text()
		}
	}()
	return lines
}

func parseChatCommand(line string) (string, string, bool) {
	const prefix = "/msg "
	if !strings.HasPrefix(line, prefix) {
		return "", "", false
	}
	arguments := strings.TrimSpace(strings.TrimPrefix(line, prefix))
	receiver, content, found := strings.Cut(arguments, " ")
	content = strings.TrimSpace(content)
	if !found || receiver == "" || content == "" {
		return "", "", false
	}
	return receiver, content, true
}

func printHelp() {
	fmt.Println("命令：/msg <接收方> <消息内容> | /help | /quit")
}
