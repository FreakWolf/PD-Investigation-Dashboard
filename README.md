# PD Investigation Dashboard

An automated, high-performance web dashboard built to ingest, filter, and reconcile massive invoice and REBNI datasets. It allows investigators to query large data stores (1GB+ text files) in seconds and run automated checks.

**Created By**: Rohit Singh

---

## 🚀 Key Features

* **Consolidated Sellers**: Automatically merges related seller files (e.g. `Cocoblu` and `Cocoblu1` are grouped as a single seller, searching both files simultaneously).
* **High-Performance Stream Processing**: Uses a custom `highWaterMark` read buffer (64MB) to slash network/disk I/O latency, allowing gigabyte-sized files to be streamed and filtered quickly.
* **In-Memory Caching**: Caches filtered vendor records in RAM. Repeated searches for the same seller + vendor load **instantly (0ms)**.
* **Smart Local Pathing**: Dynamically detects the current logged-in Windows user's home profile (`C:\Users\<Current-User>\Downloads\PD App\`). No manual `.env` modifications needed when sharing across different team members' computers.
* **Modern Web Interface**: Built with premium glassmorphic cards, complete dark/light theme support, real-time clock, loading state animations, and clean, responsive tables.

---

## 🛠️ Architecture

* **Backend**: Node.js & Express (ES Modules)
* **Frontend**: Vanilla HTML5, modern CSS3 (with custom variables for themes), and responsive JavaScript
* **Database/Storage**: Streaming read engine for `.txt` TSV datasets (designed to read directly from local folders or network drives)

---

## 🏃 Getting Started

### 📋 Prerequisites
* Install [Node.js](https://nodejs.org/) (v16 or higher recommended).

### ⚙️ Quick Installation
1. Download or clone this repository to your computer.
2. Open a command prompt inside the project folder and install dependencies:
   ```bash
   npm install
   ```

### ⚡ Launching the Dashboard
Simply **double-click the `start.bat` file** in the root of the project directory. 

This will automatically:
1. Start the Node.js backend server.
2. Launch your default web browser to [http://localhost:3000](http://localhost:3000).

---

## 📁 Data Directory Structure

By default, the application looks for files in your standard Downloads folder:
* **Invoices**: `C:\Users\<your-username>\Downloads\PD App\Invoice\`
* **REBNI**: `C:\Users\<your-username>\Downloads\PD App\REBNI\`

To change these paths or point to a network drive, create or edit the `.env` file in the root folder:
```env
INVOICE_DIR=\\your-network-path\Invoice
REBNI_DIR=\\your-network-path\REBNI
PORT=3000
```
