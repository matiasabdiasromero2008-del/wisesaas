Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "pythonw -m uvicorn app:app --host 0.0.0.0 --port 8000", 0, False
WScript.Sleep 2000
WshShell.Run "http://localhost:8000"
