#!/usr/bin/env python3
"""Solve and verify the robot application questions B1-B3.

The implementation intentionally uses only the Python standard library.
Angles are accepted in degrees at the question boundary and converted to
radians for the internal calculations. Quaternions use (x, y, z, w).
"""

from __future__ import annotations

import argparse
import math
from dataclasses import dataclass
from typing import Iterable, List, Sequence, Tuple


EPSILON = 1e-12
VERIFY_TOLERANCE = 1e-9
Vector3 = Tuple[float, float, float]
Quaternion = Tuple[float, float, float, float]
Matrix3 = Tuple[Tuple[float, float, float], ...]
Matrix4 = Tuple[Tuple[float, float, float, float], ...]


def _as_vector3(values: Sequence[float]) -> Vector3:
    if len(values) != 3:
        raise ValueError("A 3D vector must contain exactly three values.")
    return float(values[0]), float(values[1]), float(values[2])


def _as_quaternion(values: Sequence[float]) -> Quaternion:
    if len(values) != 4:
        raise ValueError("A quaternion must contain exactly four values.")
    return float(values[0]), float(values[1]), float(values[2]), float(values[3])


def _mat3_identity() -> Matrix3:
    return (
        (1.0, 0.0, 0.0),
        (0.0, 1.0, 0.0),
        (0.0, 0.0, 1.0),
    )


def _mat4_identity() -> Matrix4:
    return (
        (1.0, 0.0, 0.0, 0.0),
        (0.0, 1.0, 0.0, 0.0),
        (0.0, 0.0, 1.0, 0.0),
        (0.0, 0.0, 0.0, 1.0),
    )


def mat3_multiply(left: Matrix3, right: Matrix3) -> Matrix3:
    return tuple(
        tuple(sum(left[row][k] * right[k][column] for k in range(3)) for column in range(3))
        for row in range(3)
    )


def mat3_vector_multiply(matrix: Matrix3, vector: Vector3) -> Vector3:
    return tuple(
        sum(matrix[row][column] * vector[column] for column in range(3))
        for row in range(3)
    )  # type: ignore[return-value]


def mat3_transpose(matrix: Matrix3) -> Matrix3:
    return tuple(
        tuple(matrix[column][row] for column in range(3))
        for row in range(3)
    )


def mat4_multiply(left: Matrix4, right: Matrix4) -> Matrix4:
    return tuple(
        tuple(sum(left[row][k] * right[k][column] for k in range(4)) for column in range(4))
        for row in range(4)
    )


def mat4_from_rotation_translation(rotation: Matrix3, translation: Vector3) -> Matrix4:
    return (
        (rotation[0][0], rotation[0][1], rotation[0][2], translation[0]),
        (rotation[1][0], rotation[1][1], rotation[1][2], translation[1]),
        (rotation[2][0], rotation[2][1], rotation[2][2], translation[2]),
        (0.0, 0.0, 0.0, 1.0),
    )


def mat4_rotation(matrix: Matrix4) -> Matrix3:
    return (
        (matrix[0][0], matrix[0][1], matrix[0][2]),
        (matrix[1][0], matrix[1][1], matrix[1][2]),
        (matrix[2][0], matrix[2][1], matrix[2][2]),
    )


def mat4_translation(matrix: Matrix4) -> Vector3:
    return matrix[0][3], matrix[1][3], matrix[2][3]


def mat4_inverse(transform: Matrix4) -> Matrix4:
    rotation = mat4_rotation(transform)
    translation = mat4_translation(transform)
    inverse_rotation = mat3_transpose(rotation)
    inverse_translation = tuple(
        -value for value in mat3_vector_multiply(inverse_rotation, translation)
    )
    return mat4_from_rotation_translation(
        inverse_rotation,
        inverse_translation,  # type: ignore[arg-type]
    )


def rot_x(angle_rad: float) -> Matrix3:
    cosine = math.cos(angle_rad)
    sine = math.sin(angle_rad)
    return (
        (1.0, 0.0, 0.0),
        (0.0, cosine, -sine),
        (0.0, sine, cosine),
    )


def rot_y(angle_rad: float) -> Matrix3:
    cosine = math.cos(angle_rad)
    sine = math.sin(angle_rad)
    return (
        (cosine, 0.0, sine),
        (0.0, 1.0, 0.0),
        (-sine, 0.0, cosine),
    )


def rot_z(angle_rad: float) -> Matrix3:
    cosine = math.cos(angle_rad)
    sine = math.sin(angle_rad)
    return (
        (cosine, -sine, 0.0),
        (sine, cosine, 0.0),
        (0.0, 0.0, 1.0),
    )


def rpy_zyx_to_rotation(rpy_deg: Sequence[float]) -> Matrix3:
    """Convert fixed-angle ZYX RPY in degrees to a rotation matrix."""

    rx, ry, rz = (math.radians(value) for value in rpy_deg)
    return mat3_multiply(
        mat3_multiply(rot_z(rz), rot_y(ry)),
        rot_x(rx),
    )


def rotation_to_rpy_zyx(rotation: Matrix3) -> Vector3:
    """Return the principal fixed-angle ZYX RPY representation in degrees."""

    sin_pitch = max(-1.0, min(1.0, -rotation[2][0]))
    pitch = math.asin(sin_pitch)
    cosine_pitch = math.cos(pitch)

    if abs(cosine_pitch) > EPSILON:
        roll = math.atan2(rotation[2][1], rotation[2][2])
        yaw = math.atan2(rotation[1][0], rotation[0][0])
    else:
        # At gimbal lock, yaw is set to zero and roll carries the remaining angle.
        roll = math.atan2(-rotation[1][2], rotation[1][1])
        yaw = 0.0

    return math.degrees(roll), math.degrees(pitch), math.degrees(yaw)


def quaternion_normalize(quaternion: Quaternion) -> Quaternion:
    norm = math.sqrt(sum(value * value for value in quaternion))
    if norm <= EPSILON:
        raise ValueError("A zero-length quaternion is invalid.")
    return tuple(value / norm for value in quaternion)  # type: ignore[return-value]


def quaternion_conjugate(quaternion: Quaternion) -> Quaternion:
    x, y, z, w = quaternion
    return -x, -y, -z, w


def quaternion_multiply(left: Quaternion, right: Quaternion) -> Quaternion:
    lx, ly, lz, lw = left
    rx, ry, rz, rw = right
    return (
        lw * rx + lx * rw + ly * rz - lz * ry,
        lw * ry - lx * rz + ly * rw + lz * rx,
        lw * rz + lx * ry - ly * rx + lz * rw,
        lw * rw - lx * rx - ly * ry - lz * rz,
    )


def quaternion_to_rotation(quaternion: Quaternion) -> Matrix3:
    x, y, z, w = quaternion_normalize(quaternion)
    return (
        (
            1.0 - 2.0 * (y * y + z * z),
            2.0 * (x * y - z * w),
            2.0 * (x * z + y * w),
        ),
        (
            2.0 * (x * y + z * w),
            1.0 - 2.0 * (x * x + z * z),
            2.0 * (y * z - x * w),
        ),
        (
            2.0 * (x * z - y * w),
            2.0 * (y * z + x * w),
            1.0 - 2.0 * (x * x + y * y),
        ),
    )


def rotation_to_quaternion(rotation: Matrix3) -> Quaternion:
    """Convert a rotation matrix to (x, y, z, w)."""

    trace = rotation[0][0] + rotation[1][1] + rotation[2][2]
    if trace > 0.0:
        scale = math.sqrt(trace + 1.0) * 2.0
        quaternion = (
            (rotation[2][1] - rotation[1][2]) / scale,
            (rotation[0][2] - rotation[2][0]) / scale,
            (rotation[1][0] - rotation[0][1]) / scale,
            0.25 * scale,
        )
    elif rotation[0][0] > rotation[1][1] and rotation[0][0] > rotation[2][2]:
        scale = math.sqrt(1.0 + rotation[0][0] - rotation[1][1] - rotation[2][2]) * 2.0
        quaternion = (
            0.25 * scale,
            (rotation[0][1] + rotation[1][0]) / scale,
            (rotation[0][2] + rotation[2][0]) / scale,
            (rotation[2][1] - rotation[1][2]) / scale,
        )
    elif rotation[1][1] > rotation[2][2]:
        scale = math.sqrt(1.0 + rotation[1][1] - rotation[0][0] - rotation[2][2]) * 2.0
        quaternion = (
            (rotation[0][1] + rotation[1][0]) / scale,
            0.25 * scale,
            (rotation[1][2] + rotation[2][1]) / scale,
            (rotation[0][2] - rotation[2][0]) / scale,
        )
    else:
        scale = math.sqrt(1.0 + rotation[2][2] - rotation[0][0] - rotation[1][1]) * 2.0
        quaternion = (
            (rotation[0][2] + rotation[2][0]) / scale,
            (rotation[1][2] + rotation[2][1]) / scale,
            0.25 * scale,
            (rotation[1][0] - rotation[0][1]) / scale,
        )

    normalized = quaternion_normalize(quaternion)
    # Canonicalize the sign so output is stable. q and -q are equivalent.
    if normalized[3] < -EPSILON or (
        abs(normalized[3]) <= EPSILON
        and next((value for value in normalized[:3] if abs(value) > EPSILON), 0.0) < 0.0
    ):
        normalized = tuple(-value for value in normalized)  # type: ignore[assignment]
    return normalized


def pose_matrix(position: Vector3, rpy_deg: Sequence[float]) -> Matrix4:
    return mat4_from_rotation_translation(
        rpy_zyx_to_rotation(rpy_deg),
        _as_vector3(position),
    )


@dataclass(frozen=True)
class Pose:
    position: Vector3
    quaternion: Quaternion

    @staticmethod
    def from_rpy(position: Sequence[float], rpy_deg: Sequence[float]) -> "Pose":
        return Pose(
            _as_vector3(position),
            rotation_to_quaternion(rpy_zyx_to_rotation(rpy_deg)),
        )

    def inverse(self) -> "Pose":
        inverse_quaternion = quaternion_conjugate(self.quaternion_normalized())
        inverse_rotation = quaternion_to_rotation(inverse_quaternion)
        inverse_position = tuple(
            -value for value in mat3_vector_multiply(inverse_rotation, self.position)
        )
        return Pose(
            inverse_position,  # type: ignore[arg-type]
            inverse_quaternion,
        )

    def compose(self, other: "Pose") -> "Pose":
        rotation = quaternion_to_rotation(self.quaternion_normalized())
        translated_other = mat3_vector_multiply(rotation, other.position)
        position = tuple(
            self.position[index] + translated_other[index]
            for index in range(3)
        )
        quaternion = quaternion_multiply(
            self.quaternion_normalized(),
            other.quaternion_normalized(),
        )
        return Pose(position, quaternion)  # type: ignore[arg-type]

    def quaternion_normalized(self) -> Quaternion:
        return quaternion_normalize(self.quaternion)

    def to_matrix(self) -> Matrix4:
        return mat4_from_rotation_translation(
            quaternion_to_rotation(self.quaternion_normalized()),
            self.position,
        )


def matrix_max_abs_diff(left: Matrix4, right: Matrix4) -> float:
    return max(
        abs(left[row][column] - right[row][column])
        for row in range(4)
        for column in range(4)
    )


def vector_max_abs_diff(left: Vector3, right: Vector3) -> float:
    return max(abs(left[index] - right[index]) for index in range(3))


def assert_matrix_close(left: Matrix4, right: Matrix4, tolerance: float = VERIFY_TOLERANCE) -> float:
    error = matrix_max_abs_diff(left, right)
    if error >= tolerance:
        raise AssertionError(f"Matrix error {error:.3e} is not below {tolerance:.3e}.")
    return error


def assert_vector_close(left: Vector3, right: Vector3, tolerance: float = VERIFY_TOLERANCE) -> float:
    error = vector_max_abs_diff(left, right)
    if error >= tolerance:
        raise AssertionError(f"Vector error {error:.3e} is not below {tolerance:.3e}.")
    return error


def _display_value(value: float, digits: int) -> float:
    return 0.0 if abs(value) < 0.5 * 10 ** (-digits) else value


def format_vector(values: Iterable[float], digits: int = 6) -> str:
    return "(" + ", ".join(
        f"{_display_value(value, digits):.{digits}f}" for value in values
    ) + ")"


def format_matrix(matrix: Sequence[Sequence[float]], digits: int = 9) -> str:
    return "\n".join(
        "[ "
        + "  ".join(
            f"{_display_value(value, digits):.{digits}f}" for value in row
        )
        + " ]"
        for row in matrix
    )


def format_pose(name: str, transform: Matrix4) -> str:
    rotation = mat4_rotation(transform)
    position = mat4_translation(transform)
    rpy = rotation_to_rpy_zyx(rotation)
    quaternion = rotation_to_quaternion(rotation)
    return "\n".join(
        [
            name,
            f"  translation(m): {format_vector(position)}",
            "  rotation matrix:",
            "\n".join(
                f"    {line}"
                for line in format_matrix(rotation).splitlines()
            ),
            f"  RPY-ZYX(deg): {format_vector(rpy)}",
            f"  quaternion(x,y,z,w): {format_vector(quaternion)}",
        ]
    )


def solve_b1() -> Tuple[Matrix4, float]:
    flange_to_gripper = pose_matrix((0.0, 0.0, 0.165), (0.0, 0.0, 45.0))
    base_to_object = pose_matrix((0.520, -0.180, 0.120), (180.0, 0.0, -30.0))

    matrix_result = mat4_multiply(base_to_object, mat4_inverse(flange_to_gripper))

    base_to_object_pose = Pose.from_rpy((0.520, -0.180, 0.120), (180.0, 0.0, -30.0))
    flange_to_gripper_pose = Pose.from_rpy((0.0, 0.0, 0.165), (0.0, 0.0, 45.0))
    quaternion_result = base_to_object_pose.compose(flange_to_gripper_pose.inverse())
    cross_error = assert_matrix_close(matrix_result, quaternion_result.to_matrix())
    return matrix_result, cross_error


def solve_b2() -> Tuple[dict, float]:
    base_to_flange = pose_matrix((0.420, 0.150, 0.560), (150.0, 0.0, 45.0))
    flange_to_gripper = pose_matrix((0.0, 0.0, 0.165), (0.0, 0.0, 90.0))
    gripper_to_object = pose_matrix((0.025, 0.0, 0.060), (0.0, 0.0, 0.0))

    base_to_gripper = mat4_multiply(base_to_flange, flange_to_gripper)
    base_to_object = mat4_multiply(base_to_gripper, gripper_to_object)
    flange_to_object = mat4_multiply(flange_to_gripper, gripper_to_object)

    target_base_to_object = pose_matrix((0.350, -0.450, 0.090), (180.0, 0.0, 0.0))
    target_base_to_flange = mat4_multiply(
        target_base_to_object,
        mat4_inverse(flange_to_object),
    )

    base_to_flange_pose = Pose.from_rpy((0.420, 0.150, 0.560), (150.0, 0.0, 45.0))
    flange_to_gripper_pose = Pose.from_rpy((0.0, 0.0, 0.165), (0.0, 0.0, 90.0))
    gripper_to_object_pose = Pose.from_rpy((0.025, 0.0, 0.060), (0.0, 0.0, 0.0))
    target_base_to_object_pose = Pose.from_rpy((0.350, -0.450, 0.090), (180.0, 0.0, 0.0))

    quaternion_base_to_gripper = base_to_flange_pose.compose(flange_to_gripper_pose)
    quaternion_base_to_object = quaternion_base_to_gripper.compose(gripper_to_object_pose)
    quaternion_flange_to_object = flange_to_gripper_pose.compose(gripper_to_object_pose)
    quaternion_target_base_to_flange = target_base_to_object_pose.compose(
        quaternion_flange_to_object.inverse()
    )

    cross_error = max(
        assert_matrix_close(base_to_gripper, quaternion_base_to_gripper.to_matrix()),
        assert_matrix_close(base_to_object, quaternion_base_to_object.to_matrix()),
        assert_matrix_close(flange_to_object, quaternion_flange_to_object.to_matrix()),
        assert_matrix_close(target_base_to_flange, quaternion_target_base_to_flange.to_matrix()),
    )
    back_error = assert_matrix_close(
        mat4_multiply(target_base_to_flange, flange_to_object),
        target_base_to_object,
    )
    return {
        "base_to_gripper": base_to_gripper,
        "base_to_object": base_to_object,
        "flange_to_object": flange_to_object,
        "target_base_to_flange": target_base_to_flange,
        "back_error": back_error,
    }, cross_error


def solve_b3() -> Tuple[dict, float]:
    fx, fy, cx, cy = 800.0, 800.0, 640.0, 360.0
    u, v, z_camera = 720.0, 280.0, 0.400
    point_camera: Vector3 = (
        (u - cx) * z_camera / fx,
        (v - cy) * z_camera / fy,
        z_camera,
    )

    camera_to_base = pose_matrix((0.700, -0.200, 1.000), (180.0, 0.0, 15.0))
    rotation_camera_to_base = mat4_rotation(camera_to_base)
    point_base = tuple(
        camera_to_base[row][3]
        + sum(rotation_camera_to_base[row][column] * point_camera[column] for column in range(3))
        for row in range(3)
    )  # type: ignore[assignment]

    base_to_object = pose_matrix(point_base, (180.0, 0.0, 0.0))
    flange_to_gripper = pose_matrix((0.0, 0.0, 0.165), (0.0, 0.0, 45.0))
    target_base_to_flange = mat4_multiply(
        base_to_object,
        mat4_inverse(flange_to_gripper),
    )

    camera_to_base_pose = Pose.from_rpy((0.700, -0.200, 1.000), (180.0, 0.0, 15.0))
    flange_to_gripper_pose = Pose.from_rpy((0.0, 0.0, 0.165), (0.0, 0.0, 45.0))
    quaternion_point_base = tuple(
        camera_to_base_pose.position[row]
        + mat3_vector_multiply(
            quaternion_to_rotation(camera_to_base_pose.quaternion_normalized()),
            point_camera,
        )[row]
        for row in range(3)
    )  # type: ignore[assignment]
    quaternion_base_to_object = Pose.from_rpy(quaternion_point_base, (180.0, 0.0, 0.0))
    quaternion_target_base_to_flange = quaternion_base_to_object.compose(
        flange_to_gripper_pose.inverse()
    )

    cross_error = max(
        assert_vector_close(point_base, quaternion_point_base),
        assert_matrix_close(target_base_to_flange, quaternion_target_base_to_flange.to_matrix()),
    )
    back_error = assert_matrix_close(
        mat4_multiply(target_base_to_flange, flange_to_gripper),
        base_to_object,
    )
    return {
        "point_camera": point_camera,
        "point_base": point_base,
        "base_to_object": base_to_object,
        "target_base_to_flange": target_base_to_flange,
        "back_error": back_error,
    }, cross_error


def run_b1() -> str:
    result, cross_error = solve_b1()
    return "\n".join(
        [
            "=== B1: object pose -> flange pose ===",
            format_pose("T_base_flange", result),
            f"  matrix/quaternion cross-check max error: {cross_error:.3e}",
            f"  verification: PASS (< {VERIFY_TOLERANCE:.1e})",
        ]
    )


def run_b2() -> str:
    results, cross_error = solve_b2()
    return "\n".join(
        [
            "=== B2: forward pose + unload inverse ===",
            format_pose("T_base_gripper", results["base_to_gripper"]),
            format_pose("T_base_object", results["base_to_object"]),
            format_pose("T_flange_object (cached constant chain)", results["flange_to_object"]),
            format_pose("T_base_flange_target", results["target_base_to_flange"]),
            f"  matrix/quaternion cross-check max error: {cross_error:.3e}",
            f"  unload back-substitution max error: {results['back_error']:.3e}",
            f"  verification: PASS (< {VERIFY_TOLERANCE:.1e})",
        ]
    )


def run_b3() -> str:
    results, cross_error = solve_b3()
    return "\n".join(
        [
            "=== B3: eye-to-hand visual localization ===",
            f"p_camera(m): {format_vector(results['point_camera'])}",
            f"p_base(m): {format_vector(results['point_base'])}",
            format_pose("T_base_object", results["base_to_object"]),
            format_pose("T_base_flange_target", results["target_base_to_flange"]),
            f"  matrix/quaternion cross-check max error: {cross_error:.3e}",
            f"  grasp back-substitution max error: {results['back_error']:.3e}",
            f"  verification: PASS (< {VERIFY_TOLERANCE:.1e})",
        ]
    )


def run_selected(case: str) -> str:
    runners = {
        "b1": run_b1,
        "b2": run_b2,
        "b3": run_b3,
    }
    if case == "all":
        return "\n\n".join(runners[name]() for name in ("b1", "b2", "b3"))
    return runners[case]()


def main() -> None:
    parser = argparse.ArgumentParser(description="Solve robot practice questions B1-B3.")
    parser.add_argument(
        "--case",
        choices=("all", "b1", "b2", "b3"),
        default="all",
        help="Run all cases or one selected case. Default: all.",
    )
    parser.add_argument(
        "--output",
        help="Also save the console report to this UTF-8 text file.",
    )
    args = parser.parse_args()

    report = run_selected(args.case)
    print(report)
    if args.output:
        with open(args.output, "w", encoding="utf-8", newline="\n") as output_file:
            output_file.write(report)
            output_file.write("\n")


if __name__ == "__main__":
    main()
