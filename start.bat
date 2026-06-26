@echo off
title PD Investigation Dashboard Launcher
echo =======================================================
echo  PD Investigation Dashboard
echo  Created By: Rohit Singh
echo =======================================================
echo.
echo Starting backend server and opening dashboard...
echo.

:: Launch the default browser to the local server port
start "" "http://localhost:3000"

:: Start the node server
npm start
