@echo off
setlocal
cd /d "%~dp0"
python robot_b_questions.py %*
endlocal
