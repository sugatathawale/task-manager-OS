Operating Systems Mini Project – Phase 1
Project Title:

Operating System Based Task Manager Clone

Student Name(s):

Sugat & Siddhartha
Roll No(s): 230109, 230104
Branch / Section: B-Tech CS & AI
Guide Name: Anuj Kumar Jha

1. Problem Statement

Operating systems like Windows and Linux include task manager tools (like Task Manager, top, htop) that list all running processes and allow users to manage them. Most students struggle to understand how OS exposes process information and how it handles process control. This project aims to build a Task Manager Clone that reads real OS process details and displays them in a web interface with process termination capability.

2. Objectives

Accept and display all current system processes in a structured table.

Show key OS process properties such as PID, name, user, CPU and memory usage.

Provide functionality to terminate a selected process.

Demonstrate integration between OS process data and a web client through an API.

3. Operating System Concepts Used

Process Management: Reading live system process details.

Process States: Active, running, terminated states reflected via UI.

System Calls / OS APIs: Accessing process tables from /proc or using system commands.

Process Termination: Safely killing a process by process ID (PID).

4. Architecture Overview

Backend (C Server)

Runs as an API server on Linux.

Reads process data from /proc.

Sends process list via HTTP GET.

Listens to process kill commands via HTTP POST.

Frontend (React UI)

Displays process details in a table.

Sends requests to backend to fetch current processes.

Sends termination requests for selected processes.

5. Tools & Technologies
Component	Tool / Technology
Backend	C language
HTTP API	Custom C HTTP server
Frontend	React.js, JavaScript
System API	/proc filesystem / ps command
6. Phase-1 Implementation Summary

In Phase 1, we:
✔ Built a C-based HTTP server that reads OS process information
✔ Provided API to fetch processes and kill a process
✔ Built a React UI that consumes API and displays data
✔ Embedded process termination functionality via button clicks
✔ Made the first working version of the Task Manager clone

7. Challenges & Solutions

Reading /proc required careful parsing of system files — we addressed this with structured C functions.

Ensuring safe process termination was handled by validating PIDs before sending kill signals.

Asynchronous UI updates were managed with React state and API polling.

8. Phase-1 Outcome

A fully functional Task Manager Clone where users can:
✔ View all live OS processes
✔ Trigger termination of chosen process
✔ Experience real process data dynamically in a web UI
