# AI-Powered Document Analysis Pipeline for Enterprise Procurement

## Overview
Nexus Corp, a global enterprise software company, has a procurement team that is overwhelmed by the manual process of reviewing vendor contracts and proposals. Analysts spend hours manually reading PDF and DOCX files to find key information like contract value, renewal dates, and potential risk clauses, then copy-pasting this data into spreadsheets. This process is slow, expensive, and prone to human error, causing delays in vendor onboarding and potentially exposing the company to unforeseen risks. Your task is to build a prototype system that automates this document analysis workflow.

You will build a small, multi-service application that allows a user to upload contract documents through a web interface. The system must process these documents asynchronously, use an AI model to extract key structured information, and display the results on a simple dashboard. The core of this challenge is designing a robust, decoupled system that can handle different document types and long-running AI processing tasks without blocking the user interface.
We are not looking for a pixel-perfect UI or a production-ready, scalable system. Instead, we want to see your approach to system design, your ability to integrate AI into a practical workflow, and your operational thinking. A simple but functional frontend connected to a well-designed backend architecture is the goal. Your README should be your voice, explaining the architectural choices and trade-offs you made.

## Deliverables
- A public GitHub repository URL containing your complete solution.
- A detailed `README.md` file that explains your design decisions, architectural trade-offs, and clear instructions on how to build and run the application locally (e.g., using Docker Compose).
- A functional web UI (built with React, Next.js, or similar) allowing a user to upload one or more documents and view the extracted results.
- The backend system, composed of one or more services, written in TypeScript/Node.js and containerized for easy setup.
- The conversation log from your AI assistant (e.g., ChatGPT/Claude export, VS Code Copilot Chat history). This is a mandatory deliverable.

## Suggested tools / libraries
- Frontend: React + Vite, Next.js
- Backend: Node.js with Express or Fastify
- Containerization: Docker, Docker Compose
- AI/LLM: OpenAI API, Anthropic API, or a local model via Ollama
- Document Parsing: `pdf-parse`, `mammoth.js`
- Async Communication: A simple in-memory queue, Redis, or direct async API calls between services
- Data Storage: SQLite, or simple file-based storage (e.g., JSON files)

## On AI assistants & follow-up
- We fully expect and encourage you to use AI assistants like GitHub Copilot or ChatGPT. The goal is to see how you leverage tools to build effectively.
- Be prepared to walk us through any part of the code and explain the underlying concepts and your design choices in the follow-up interview.
- Focus your time on the system's architecture and the core logic. We value a well-designed system over polished UIs or extensive boilerplate code.
- **Mandatory:** Please commit the conversation log from your AI assistant to your repository. In your README, briefly describe which tools you used and for what parts of the project.
