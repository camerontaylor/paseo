@setlocal & set "ELECTRON_RUN_AS_NODE=1" & "%~1" -e "process.stdout.write(String.fromCharCode(27)+']633;D;'+process.argv[1]+String.fromCharCode(7));process.exit(Number(process.argv[1]))" %errorlevel%
@exit /b %errorlevel%
