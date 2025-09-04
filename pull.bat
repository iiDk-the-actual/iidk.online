@echo off
setlocal

:: Variables
set USERNAME=iidk@hostii
set PASSWORD=MarcusRavioli9@hotmail.net
set REMOTE_FILE=/home/iidk/site/index.js
set LOCAL_FILE=index.js

:: Download the file using PSCP
echo %PASSWORD% | pscp -pw %PASSWORD% %USERNAME%:%REMOTE_FILE% "%LOCAL_FILE%"

if %errorlevel% neq 0 (
    echo File download failed.
    exit /b 1
) else (
    echo File downloaded successfully to "%LOCAL_FILE%".
)