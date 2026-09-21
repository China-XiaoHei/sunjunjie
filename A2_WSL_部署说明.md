# A2：WSL 部署说明

## 1. 部署目标

将 A1 的 Three.js 网站和外部控制服务部署在 WSL Ubuntu 中，并使 Windows 宿主机浏览器可以访问。

本方案采用：

- WSL Ubuntu。
- Node.js 标准库 HTTP 服务。
- 监听地址 `0.0.0.0`。
- 默认端口 `8080`。
- Windows 浏览器通过 `http://localhost:8080/` 访问。

题目要求说明网络方案。这里不使用虚拟机桥接或手工端口转发，而是使用 WSL2 的 localhost forwarding。Microsoft 文档说明，默认 NAT 模式下，Windows 通常可以通过 `localhost` 访问 WSL 内监听的服务；`.wslconfig` 中的 `localhostForwarding` 默认值为 `true`。如果当前配置关闭了该能力，则使用 WSL IP 地址访问，见第 7 节。

## 2. WSL 环境准备

在 Windows PowerShell 中进入 WSL：

```powershell
wsl
```

检查系统：

```bash
cat /etc/os-release
uname -a
```

检查 Node.js 和 npm：

```bash
node --version
npm --version
```

要求：

- Node.js 18 或更高版本。
- `curl`，用于健康检查。
- Python 3.9 或更高版本，用于运行外部控制器。

如果 WSL 没有 Node.js，可按当前 Ubuntu 环境安装。最小安装方式：

```bash
sudo apt update
sudo apt install -y nodejs npm curl python3
```

如果发行版自带 Node.js 版本过低，应改用 NodeSource、nvm 或其他已批准的 Node.js 安装方式，并在提交材料中记录实际版本。

## 3. 进入项目目录

Windows 盘符 `F:` 在 WSL 中通常挂载为 `/mnt/f`：

```bash
cd /mnt/f/实践考题/threejs_control
```

确认文件：

```bash
ls -la
ls -la public
```

脚本授权：

```bash
chmod +x start_wsl.sh stop_wsl.sh status_wsl.sh
```

项目依赖 Three.js。首次运行必须执行 `npm install`，安装完成后浏览器从本地服务加载 Three.js 模块，不再依赖外部 CDN。

```bash
npm install
```

## 4. 启动服务

推荐使用启动脚本：

```bash
./start_wsl.sh
```

脚本行为：

1. 检查 Node.js 是否存在。
2. 检查旧 PID 文件、旧进程和端口占用，防止把旧服务误判为新服务。
3. 使用 `0.0.0.0:8080` 启动 Node 服务。
4. 将进程号写入 `a1-server.pid`。
5. 将日志写入 `a1-server.log`。
6. 等待健康检查通过。

自定义端口：

```bash
PORT=8090 ./start_wsl.sh
```

自定义监听地址：

```bash
HOST=0.0.0.0 PORT=8090 ./start_wsl.sh
```

不使用脚本时可以直接启动：

```bash
node server.js --host 0.0.0.0 --port 8080
```

修改 `server.js`、`public/index.html` 或 `public/app.js` 后，必须在原终端按 `Ctrl+C` 停止旧进程，再重新执行启动命令。仅刷新浏览器不会重新加载 Node 服务代码。

如果直接启动时出现 `EADDRINUSE: address already in use 0.0.0.0:8080`，说明旧服务仍占用端口。先执行：

```bash
ss -ltnp | grep ':8080'
fuser -k 8080/tcp
```

再重新运行启动命令。不希望停止原服务时，可以改用 `--port 8090`，并访问 `http://localhost:8090/`。

## 5. 服务状态检查

查看状态：

```bash
./status_wsl.sh
```

直接检查健康接口：

```bash
curl http://127.0.0.1:8080/api/health
```

预期结果：

```json
{
  "ok": true,
  "service": "robot-threejs-external-control"
}
```

检查当前仿真状态：

```bash
curl http://127.0.0.1:8080/api/state
```

检查静态模块是否能完整返回：

```bash
curl --http1.1 -sS --max-time 5 -D - \
  http://127.0.0.1:8080/vendor/OrbitControls.js \
  -o /tmp/OrbitControls.js
wc -c /tmp/OrbitControls.js
```

响应应为 `HTTP/1.1 200 OK`，并带有 `Content-Length`；文件大小应约为 `32134` 字节。若命令超时或文件大小持续增长，先按上一节说明停止旧进程，再重新启动服务。

检查大体积 Three.js 模块是否在传输中发生数据块重复：

```bash
curl -sS --max-time 10 \
  http://127.0.0.1:8080/vendor/three.module.js \
  | grep -c "const REVISION = '170';"
```

正常结果是 `1`。结果大于 `1` 会导致浏览器控制台报告 `Identifier 'REVISION' has already been declared`，页面只显示“连接中”。当前服务端已使用显式文件偏移读取，重启到新代码后可消除该问题。

查看服务日志：

```bash
tail -f a1-server.log
```

停止服务：

```bash
./stop_wsl.sh
```

## 6. Windows 浏览器访问

服务启动后，在 Windows 浏览器打开：

```text
http://localhost:8080/
```

页面应能看到：

- 三维坐标轴和网格地面。
- P0-P4 路径。
- 红色方块。
- 页面右上角连接状态为 `已连接`。
- 右侧位置、速度和路径点状态。

页面优先使用 WebSocket 接收实时状态。如果 WSL localhost 转发导致 WebSocket 在 3 秒内无法完成连接，页面会自动切换为 HTTP `/api/state` 轮询，连接状态仍应显示为已连接。

如果页面显示但 Three.js 场景为空，应检查 `node_modules/three` 是否存在，并确认服务端的 `/vendor/three.module.js` 和 `/vendor/OrbitControls.js` 返回 200。

如果浏览器一直转圈或仍显示旧页面：

1. 在运行 Node 服务的终端按 `Ctrl+C` 停止旧进程。
2. 重新执行 `npm install`。
3. 重新启动 `node server.js --host 0.0.0.0 --port 8080`。
4. 在浏览器按 `Ctrl+F5` 强制刷新。

不要只刷新浏览器而不重启服务，因为 `server.js` 的修改必须通过重启进程生效。

## 7. WSL localhost 不可访问时的处理

先取得 WSL IP：

```bash
hostname -I
```

也可以在 Windows PowerShell 中获取指定发行版的地址：

```powershell
wsl.exe --distribution Ubuntu hostname -I
```

假设输出为 `172.28.64.1`，则在 Windows 浏览器访问：

```text
http://172.28.64.1:8080/
```

同时确认服务确实监听所有接口：

```bash
ss -ltnp | grep 8080
```

应看到类似：

```text
0.0.0.0:8080
```

如果只看到 `127.0.0.1:8080`，需要停止服务后使用：

```bash
node server.js --host 0.0.0.0 --port 8080
```

如果使用 Windows 11 22H2 或更高版本，也可以通过 `%USERPROFILE%\.wslconfig` 配置：

```ini
[wsl2]
networkingMode=mirrored
```

启用后需要执行：

```powershell
wsl --shutdown
```

然后重新启动发行版。这个配置不是本题的必需条件，默认 localhost forwarding 已足够完成本地演示。

如 WSL 使用独立虚拟网络且 Windows 防火墙阻止访问，应只针对本地测试端口 `8080` 配置允许规则，不要开放无关端口。提交时记录实际采用的访问方式。

## 8. 运行外部控制器

保持服务运行，在另一个 WSL 终端执行：

```bash
cd /mnt/f/实践考题/threejs_control
python3 controller.py --host 127.0.0.1 --port 8080 --speed 0.35
```

如果从 Windows 侧运行 Python 控制器：

```powershell
python .\controller.py --host 127.0.0.1 --port 8080 --speed 0.35
```

控制器会依次发送 P1、P2、P3、P4，并等待每个点到达后才发送下一条命令。

## 9. A2 截图验收清单

建议提交以下截图：

### 截图 1：Linux 进程和端口

终端至少显示：

```bash
./status_wsl.sh
ss -ltnp | grep 8080
```

截图中应能看出服务进程正在运行，且监听 `0.0.0.0:8080`。

### 截图 2：浏览器访问

Windows 浏览器地址栏显示：

```text
http://localhost:8080/
```

页面中应同时看到三维场景和右侧状态面板。

### 截图 3：外部控制过程

一侧显示浏览器中的方块运动，另一侧显示：

```bash
python3 controller.py --speed 0.35
```

并有 P1-P4 到达输出。

### 截图 4：健康检查和运行日志

```bash
curl http://127.0.0.1:8080/api/health
tail -n 20 a1-server.log
```

## 10. 常见问题

### 端口被占用

检查端口：

```bash
ss -ltnp | grep 8080
```

停止占用 `8080` 的旧进程：

```bash
fuser -k 8080/tcp
```

如果系统没有 `fuser`，先安装：

```bash
sudo apt install -y psmisc
```

改用其他端口：

```bash
PORT=8090 ./start_wsl.sh
```

然后访问 `http://localhost:8090/`。

### 页面可以访问但控制器连接失败

确认控制器和服务使用相同的 host、port：

```bash
curl http://127.0.0.1:8080/api/health
python3 controller.py --host 127.0.0.1 --port 8080
```

### 服务启动后立即退出

检查：

```bash
cat a1-server.log
```

常见原因是 Node.js 不存在、端口冲突或 `path.json` 格式错误。

## 11. 部署边界

本部署验证的是：

- WSL 中 Node 服务能够启动。
- 服务能够监听端口。
- Windows 浏览器能够访问页面。
- 外部 Python 程序能够通过 HTTP 控制仿真方块。

本部署不等同于公网部署，也不涉及云服务器安全组配置。Three.js 模块由 Node 服务从本地 `node_modules/three` 提供，页面运行阶段不需要访问 jsDelivr；只有首次执行 `npm install` 时需要访问 npm 软件源。

## 12. 官方参考

- [Microsoft Learn：Accessing network applications with WSL](https://learn.microsoft.com/windows/wsl/networking)
- [Microsoft Learn：WSL interop](https://learn.microsoft.com/en-us/windows/dev-environment/wsl-interop)
- [Microsoft Learn：Advanced settings configuration in WSL](https://learn.microsoft.com/en-us/windows/wsl/wsl-config)
