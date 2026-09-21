import math
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import robot_b_questions as robot


class TransformTests(unittest.TestCase):
    def assertMatrixClose(self, left, right, tolerance=1e-9):
        self.assertLess(robot.matrix_max_abs_diff(left, right), tolerance)

    def test_rotation_round_trip(self):
        rpy = (37.0, -22.0, 81.0)
        rotation = robot.rpy_zyx_to_rotation(rpy)
        recovered = robot.rotation_to_rpy_zyx(rotation)
        recovered_rotation = robot.rpy_zyx_to_rotation(recovered)
        self.assertMatrixClose(
            robot.mat4_from_rotation_translation(rotation, (0.0, 0.0, 0.0)),
            robot.mat4_from_rotation_translation(recovered_rotation, (0.0, 0.0, 0.0)),
        )

    def test_quaternion_round_trip(self):
        rotation = robot.rpy_zyx_to_rotation((180.0, 0.0, 15.0))
        quaternion = robot.rotation_to_quaternion(rotation)
        recovered_rotation = robot.quaternion_to_rotation(quaternion)
        self.assertMatrixClose(
            robot.mat4_from_rotation_translation(rotation, (0.0, 0.0, 0.0)),
            robot.mat4_from_rotation_translation(recovered_rotation, (0.0, 0.0, 0.0)),
        )

    def test_transform_inverse(self):
        transform = robot.pose_matrix((0.3, -0.2, 0.8), (150.0, 10.0, -35.0))
        self.assertMatrixClose(
            robot.mat4_multiply(transform, robot.mat4_inverse(transform)),
            robot._mat4_identity(),
        )

    def test_b1_reference_and_cross_check(self):
        result, cross_error = robot.solve_b1()
        self.assertLess(cross_error, 1e-9)
        self.assertAlmostEqual(result[0][3], 0.520, places=12)
        self.assertAlmostEqual(result[1][3], -0.180, places=12)
        self.assertAlmostEqual(result[2][3], 0.285, places=12)
        expected_rotation = robot.rpy_zyx_to_rotation((180.0, 0.0, 15.0))
        self.assertMatrixClose(
            robot.mat4_from_rotation_translation(expected_rotation, (0.0, 0.0, 0.0)),
            robot.mat4_from_rotation_translation(robot.mat4_rotation(result), (0.0, 0.0, 0.0)),
        )

    def test_b2_reference_and_back_substitution(self):
        results, cross_error = robot.solve_b2()
        self.assertLess(cross_error, 1e-9)
        self.assertLess(results["back_error"], 1e-9)
        self.assertAlmostEqual(results["base_to_object"][0][3], 0.514858823776, places=9)
        self.assertAlmostEqual(results["base_to_object"][1][3], 0.055141176224, places=9)
        self.assertAlmostEqual(results["base_to_object"][2][3], 0.377644284149, places=9)
        self.assertAlmostEqual(results["target_base_to_flange"][0][3], 0.325, places=12)
        self.assertAlmostEqual(results["target_base_to_flange"][1][3], -0.450, places=12)
        self.assertAlmostEqual(results["target_base_to_flange"][2][3], 0.315, places=12)

    def test_b3_reference_and_back_substitution(self):
        results, cross_error = robot.solve_b3()
        self.assertLess(cross_error, 1e-9)
        self.assertLess(results["back_error"], 1e-9)
        self.assertAlmostEqual(results["point_camera"][0], 0.04, places=12)
        self.assertAlmostEqual(results["point_camera"][1], -0.04, places=12)
        self.assertAlmostEqual(results["point_camera"][2], 0.4, places=12)
        self.assertAlmostEqual(results["point_base"][0], 0.728284271247, places=9)
        self.assertAlmostEqual(results["point_base"][1], -0.151010205144, places=9)
        self.assertAlmostEqual(results["point_base"][2], 0.6, places=12)
        self.assertAlmostEqual(results["target_base_to_flange"][2][3], 0.765, places=12)


if __name__ == "__main__":
    unittest.main()
