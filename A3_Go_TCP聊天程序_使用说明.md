# A3：Go TCP 多客户端聊天程序使用说明

## 1. 实现范围

本实现对应题目 A3，选择 Go 和 TCP：

- Server 为控制台程序，支持多个 Client 同时在线。
- Client 为控制台程序，可以启动多个实例。
- Client A 可以给 Client B 发送私聊消息，Client B 也可以回复。
- 协议固定包含消息类型、发送方、接收方、内容长度和内容。
- 使用长度前缀解决 TCP 粘包和拆包。
- 支持重复用户名检查、离线用户错误、异常帧限制和断线清理。
- 只使用 Go 标准库，不依赖第三方包。

题目要求选择一门本人目前不太熟悉的语言。本项目按现有解题方案选择 Go，但“是否不熟悉”属于提交者个人事实，提交前应按实际情况如实说明。

## 2. 目录结构

```text
chat_go/
  go.mod
  cmd/
    server/main.go
    client/main.go
  internal/
    protocol/
      protocol.go
      protocol_test.go
    chatserver/
      server.go
      server_test.go
```

职责划分：

| 目录 | 职责 |
|---|---|
| `cmd/server` | 参数解析、监听端口、停止信号处理 |
| `cmd/client` | 用户注册、命令输入、异步接收消息 |
| `internal/protocol` | 帧编码、帧解码、JSON 校验、长度限制 |
| `internal/chatserver` | 在线用户表、并发连接、消息转发、断线清理 |

## 3. 环境要求

- Go 1.20 或更高版本。
- Windows、WSL Ubuntu 或普通 Linux 均可。
- 本机演示默认使用 TCP `9090` 端口。

检查 Go：

```bash
go version
```

WSL Ubuntu 未安装 Go 时：

```bash
sudo apt update
sudo apt install -y golang-go
```

## 4. 测试与构建

进入项目：

```bash
cd /mnt/f/实践考题/chat_go
```

Windows PowerShell 使用：

```powershell
cd F:\实践考题\chat_go
```

运行测试：

```bash
go test ./...
```

Linux 或 WSL 构建：

```bash
mkdir -p bin
go build -o bin/chat-server ./cmd/server
go build -o bin/chat-client ./cmd/client
```

Windows PowerShell 构建：

```powershell
New-Item -ItemType Directory -Force bin
go build -o bin\chat-server.exe ./cmd/server
go build -o bin\chat-client.exe ./cmd/client
```

当前目录已经生成可直接运行的交付文件：

```text
bin/chat-server.exe
bin/chat-client.exe
bin/chat-server-linux-amd64
bin/chat-client-linux-amd64
```

Linux/WSL 首次运行交付文件前执行：

```bash
chmod +x bin/chat-server-linux-amd64 bin/chat-client-linux-amd64
```

## 5. 启动与聊天

### 5.1 启动服务器

直接运行源码：

```bash
go run ./cmd/server -host 0.0.0.0 -port 9090
```

或运行构建结果：

```bash
./bin/chat-server-linux-amd64 -host 0.0.0.0 -port 9090
```

Windows 使用：

```powershell
.\bin\chat-server.exe -host 0.0.0.0 -port 9090
```

### 5.2 启动两个客户端

终端 1：

```bash
go run ./cmd/client -name alice -host 127.0.0.1 -port 9090
```

终端 2：

```bash
go run ./cmd/client -name bob -host 127.0.0.1 -port 9090
```

如果使用构建后的程序，将 `go run ./cmd/client` 替换为 `./bin/chat-client-linux-amd64`；Windows 使用 `.\bin\chat-client.exe`。

Alice 向 Bob 发送消息：

```text
/msg bob 你好，我是 Alice
```

Bob 回复 Alice：

```text
/msg alice 收到，我是 Bob
```

其他命令：

```text
/help
/quit
```

## 6. 自定义 TCP 协议

每个完整数据帧由两部分组成：

```text
+----------------------+----------------------------------+
| 4 字节消息体长度     | N 字节 UTF-8 JSON 消息体         |
| uint32，大端序       | N 等于前面长度字段的值           |
+----------------------+----------------------------------+
```

4 字节帧长度只计算 JSON 消息体，不包含长度头自身。单个 JSON 消息体最大为 `1 MiB`。

JSON 示例：

```json
{
  "type": "chat",
  "sender": "alice",
  "receiver": "bob",
  "contentLength": 21,
  "content": "你好，我是 Alice"
}
```

字段说明：

| 字段 | 含义 |
|---|---|
| `type` | 消息类型，例如 `register`、`register_ack`、`chat`、`delivered`、`error` |
| `sender` | 发送方；服务端会校验其与连接注册用户名一致，防止冒名发送 |
| `receiver` | 接收方用户名 |
| `contentLength` | `content` 使用 UTF-8 编码后的字节数，不是字符数 |
| `content` | 消息正文或系统提示 |

例如中文“你好”是 2 个 Unicode 字符，但 UTF-8 编码占 6 字节，因此 `contentLength` 必须是 `6`。

## 7. TCP 粘包和拆包处理

TCP 只提供有序字节流，不保留应用层消息边界：

- 一条消息可能被拆成多次 `Read` 才能收到。
- 多条消息也可能在一次 `Read` 中同时到达。
- 因此不能假设一次 `Read` 就是一条完整消息。

本实现的接收流程：

1. 使用 `io.ReadFull` 准确读取 4 字节长度头。
2. 按大端序解析 JSON 消息体长度。
3. 长度必须在 `1` 到 `1 MiB` 之间，避免异常长度造成过量内存分配。
4. 再使用 `io.ReadFull` 准确读取指定长度的 JSON 消息体。
5. 解码 JSON，拒绝未知字段，并校验 `contentLength` 是否等于正文 UTF-8 字节数。
6. 缓冲区中剩余的数据继续用于解析下一帧，所以多帧粘在一起也不会混淆。

发送端循环写完“长度头 + JSON 消息体”，处理底层 `Write` 只写入部分字节的情况。每个客户端连接还有独立发送锁，防止多个服务端协程同时向同一连接写数据时造成帧交错。

## 8. 并发和异常处理

- 服务端为每个 TCP 连接启动一个 goroutine。
- 在线用户表使用 `sync.RWMutex` 保护。
- 同一用户名只能有一个在线连接。
- 注册必须在连接建立后的 10 秒内完成。
- 客户端不能伪造其他发送方用户名。
- 私聊正文不能为空，最大为 `64 KiB`。
- 目标用户不存在时，发送方收到 `error` 消息。
- 转发成功后，发送方收到 `delivered` 消息。
- 连接断开后，服务端只删除与该连接对应的在线用户记录。

## 9. 自动化测试覆盖

`go test ./...` 覆盖以下行为：

1. 每次只返回 1 字节时，接收端仍能正确组装完整帧，验证拆包处理。
2. 两个帧连续写入同一字节流时，可以依次解析，验证粘包处理。
3. 中文正文按 UTF-8 字节数计算 `contentLength`。
4. 超过 `1 MiB` 的帧在分配消息体内存前被拒绝。
5. 重复用户名注册被拒绝。
6. Alice 到 Bob、Bob 到 Alice 的双向消息转发。
7. 向不存在用户发送消息时返回错误。

## 10. 演示与截图建议

建议并排打开三个终端：

1. Server 终端显示 Alice、Bob 上线和双向消息转发日志。
2. Alice Client 显示发送给 Bob 后的送达确认，以及收到 Bob 的回复。
3. Bob Client 显示收到 Alice 的消息，并发送回复。

另补一张 `go test ./...` 全部通过的截图，可以同时证明协议拆包、粘包和异常处理已被自动化验证。

## 11. 已知边界

- 这是局域网或本机演示程序，没有 TLS 加密、密码认证和消息持久化。
- 用户身份只在单次 TCP 连接内通过用户名注册，不适合直接部署到不可信公网。
- 服务端重启后在线状态和消息不会保留。
- 本实现完成题目要求的点对点聊天，没有额外加入群聊、文件传输或 GUI。
