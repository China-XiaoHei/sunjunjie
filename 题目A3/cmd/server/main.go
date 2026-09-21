package main

import (
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"os"
	"os/signal"
	"strconv"
	"syscall"

	"a3chat/internal/chatserver"
)

func main() {
	host := flag.String("host", "0.0.0.0", "监听地址")
	port := flag.Int("port", 9090, "监听端口")
	flag.Parse()

	if *port < 1 || *port > 65535 {
		log.Fatalf("端口必须在 1 到 65535 之间，当前值：%d", *port)
	}
	address := net.JoinHostPort(*host, strconv.Itoa(*port))
	listener, err := net.Listen("tcp", address)
	if err != nil {
		log.Fatalf("监听 %s 失败：%v", address, err)
	}
	defer listener.Close()

	logger := log.New(os.Stdout, "[服务器] ", log.LstdFlags|log.Lmicroseconds)
	server := chatserver.New(logger)
	logger.Printf("TCP 聊天服务已启动，监听 %s", listener.Addr())

	stopSignals := make(chan os.Signal, 1)
	signal.Notify(stopSignals, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-stopSignals
		logger.Print("收到停止信号，正在关闭监听端口")
		_ = listener.Close()
	}()

	if err := server.Serve(listener); err != nil && !errors.Is(err, net.ErrClosed) {
		fmt.Fprintf(os.Stderr, "服务器退出：%v\n", err)
		os.Exit(1)
	}
	logger.Print("服务器已停止")
}
