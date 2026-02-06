# Operating Systems Mini Project – Phase 1 (Simplified)

PROJECT PROPOSAL TEMPLATE
Operating Systems Mini Project – Proposal

Project Title: CPU Scheduling Simulator with Priority + Banker's Algorithm
Student Name(s):Sugat & Siddhartha
Roll No(s):230109 ,230104
Branch / Section: B-Tech CS & Ai
Academic Year: 230109
Guide Name:Anuj kumar jha 

1. Problem Statement
We need a simple way to understand how an operating system schedules processes on the CPU. This project simulates scheduling algorithms and shows waiting time, turnaround time, and execution order.

2. Objectives
Objective 1: Accept process details (arrival time, burst time, priority).
Objective 2: Simulate simple scheduling algorithms and show results.
Objective 3: Include one advanced OS feature (Banker's Algorithm for deadlock avoidance).

3. Operating System Concepts Used
CPU Scheduling
Priority Scheduling
Deadlock Avoidance (Banker's Algorithm)

4. Algorithms / Techniques
FCFS (First Come First Served): Simple queue-based scheduling.
Priority Scheduling (non-preemptive): Lower priority number runs first.
Banker's Algorithm (Advanced): Checks safe state before resource allocation.

5. Tools & Technologies
Language: C
Compiler: GCC / Turbo C

6. Expected Outcome
A console program that takes process input and prints a Gantt chart plus average waiting and turnaround times for each algorithm. Demonstrates OS scheduling clearly with one advanced method.

SOFTWARE REQUIREMENT SPECIFICATION (SRS)

1. Introduction
This project simulates CPU scheduling to help students understand how an OS decides process execution order. Scope is limited to console-based simulation with simple input.

2. Functional Requirements
System shall accept process details (PID, arrival time, burst time, priority).
System shall simulate scheduling algorithms (FCFS, Priority Scheduling).
System shall display results (Gantt chart, waiting time, turnaround time, averages).

3. Non-Functional Requirements
Platform independent (standard C).
User friendly console prompts.
Deterministic output for a given input.

4. Constraints
Implemented in C.
Console based.
No external libraries.

5. Assumptions
Valid user input.
Single system environment.

DESIGN DOCUMENT TEMPLATE

1. System Architecture
Input Module: reads process/resource data.
Scheduler Engine: runs FCFS and Priority Scheduling.
Deadlock Module: runs Banker's Algorithm safety check.
Output Module: prints Gantt chart, averages, and safe/unsafe state.

2. Algorithm Description
Step 1: Read process count and details.
Step 2: Run FCFS and compute metrics.
Step 3: Run Priority Scheduling (non-preemptive) and compute metrics.
Step 4: Run Banker's Algorithm to check safe state (advanced feature).
Step 5: Display Gantt chart, averages, and safe/unsafe result.

3. Flowchart (Text)
Start → Input number of processes → Input (PID, arrival, burst, priority) → Select algorithm → Run scheduler → Compute waiting & turnaround times → Display Gantt chart + averages → End.
For Banker's Algorithm: Calculate Need = Max - Allocation, then check if a safe sequence exists before granting resources.

4. Data Structures Used
Arrays for process list and resources.
Structures for process fields (PID, arrival, burst, priority).
Matrices for Allocation, Max, Need (Banker’s Algorithm).

FINAL PROJECT REPORT FORMAT
Chapters
Abstract
Introduction
Literature Review
Problem Statement
Objectives
System Design
Algorithm
Implementation
Results & Discussion
Conclusion
Future Enhancements
References

Note: This is a simplified Phase-1 version with two basic scheduling algorithms and one advanced OS feature (Banker’s Algorithm).
