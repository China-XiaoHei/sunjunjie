# B 题 Python 实现说明

本目录中的 `robot_b_questions.py` 完成机器人应用相关题 B1、B2、B3。

程序只使用 Python 标准库，不需要安装 `numpy`、`scipy` 或其他第三方包。
因此本项目不提供空的 `requirements.txt`，避免把标准库程序误判为需要安装第三方依赖。

当前目录同时提供 `run_robot_b_questions.bat`，用于 Windows 命令行或双击启动。

## 运行环境

- Python 3.9 或更高版本
- Windows、Linux、macOS 均可

## 运行程序

在当前目录执行：

```powershell
python .\robot_b_questions.py
```

默认运行 B1-B3，并在控制台输出：

- 平移，单位为 m，保留 6 位小数
- 4x4 齐次变换矩阵
- RPY-ZYX，单位为 deg
- 四元数，顺序为 `(x, y, z, w)`
- 矩阵路径与四元数路径的最大误差
- 反解后的回代误差

只运行某一道题：

```powershell
python .\robot_b_questions.py --case b1
python .\robot_b_questions.py --case b2
python .\robot_b_questions.py --case b3
```

保存运行报告：

```powershell
python .\robot_b_questions.py --output .\robot_b_results.txt
```

B1-B3 的独立入口位于题目目录中，均通过脚本位置引用本目录的公共实现，不依赖当前工作目录：

```powershell
cd F:\实践考题
python .\题目B1\solve.py
python .\题目B2\solve.py
python .\题目B3\solve.py
```

## 运行测试

```powershell
python -m unittest -v .\test_robot_b_questions.py
```

## 数学约定

- 平移单位为米。
- 题面输入角度为 deg，内部转换为 rad。
- 固定角 ZYX：

```text
R = Rz(rz) * Ry(ry) * Rx(rx)
```

- 四元数顺序为 `(x, y, z, w)`。
- `T_A_B` 表示坐标系 B 在坐标系 A 下的位姿，满足：

```text
p_A = T_A_B * p_B
```

- 刚性夹持的变换链：

```text
T_base_object =
    T_base_flange
    * T_flange_gripper
    * T_gripper_object
```

## 两条独立计算路径

程序同时实现：

1. 旋转矩阵和 4x4 齐次矩阵路径。
2. 四元数路径：四元数乘法、共轭求逆和位移旋转。

两条路径最终转换为齐次矩阵后进行比较。比较依据是矩阵最大绝对误差，不直接比较 RPY 文本或四元数符号，因为：

- 四元数 `q` 与 `-q` 表示同一个旋转。
- 一个旋转可能有多组等价 RPY 表示。

程序要求交叉验证和回代误差均小于 `1e-9`。

## B1 计算

已知工件与夹持中心重合，所以 `T_gripper_object = I`：

```text
T_base_flange =
    T_base_object
    * inverse(T_flange_gripper)
```

参考法兰结果：

```text
translation = (0.520000, -0.180000, 0.285000) m
RPY         = (180, 0, 15) deg
quaternion  = (0.991445, 0.130526, 0, 0)
```

## B2 计算

当前位姿：

```text
T_base_gripper =
    T_base_flange
    * T_flange_gripper

T_base_object =
    T_base_gripper
    * T_gripper_object
```

固定工具链缓存：

```text
T_flange_object =
    T_flange_gripper
    * T_gripper_object
```

下料法兰反解：

```text
T_base_flange_target =
    T_base_object_target
    * inverse(T_flange_object)
```

参考结果：

```text
当前夹持中心平移 = (0.478336, 0.091664, 0.417106) m
当前工件平移     = (0.514859, 0.055141, 0.377644) m
缓存链平移       = (0.000000, 0.025000, 0.225000) m
目标法兰平移     = (0.325000, -0.450000, 0.315000) m
目标法兰 RPY     = (180, 0, 90) deg
```

## B3 计算

像素反投影：

```text
x_camera = (u - cx) * Z_camera / fx
y_camera = (v - cy) * Z_camera / fy
z_camera = Z_camera
```

题面数据得到：

```text
p_camera = (0.040000, -0.040000, 0.400000) m
p_base   = (0.728284, -0.151010, 0.600000) m
```

由于相机采用 eye-to-hand 固定安装方式，`T_base_camera` 是固定外参，像素转换到基座系时不需要机器人当前位姿。

圆盘平放且绕自身法向旋转对称，选用：

```text
T_base_object:
translation = p_base
RPY = (180, 0, 0) deg
```

抓取法兰目标参考结果：

```text
translation = (0.728284, -0.151010, 0.765000) m
RPY         = (180, 0, 45) deg
quaternion  = (0.923880, 0.382683, 0, 0)
```

## 验证边界

本程序验证的是坐标变换、姿态转换、交叉计算和回代误差，不验证真实机器人的：

- 关节限位
- 逆运动学可达性
- 奇异位形
- 碰撞
- 速度和加速度限制
- 控制器实际姿态格式
