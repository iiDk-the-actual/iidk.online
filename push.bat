@echo off
setlocal

:: Variables
set USERNAME=iidk@hostii
set PASSWORD=MarcusRavioli9@hotmail.net
set LOCAL_FILE=index.js
set REMOTE_FILE=/home/iidk/site/index.js

:: Upload the file using PSCP
echo %PASSWORD% | pscp -pw %PASSWORD% "%LOCAL_FILE%" %USERNAME%:%REMOTE_FILE%

if %errorlevel% neq 0 (
    echo File upload failed.
    exit /b 1
) else (
    echo File uploaded successfully to "%REMOTE_FILE%".
)