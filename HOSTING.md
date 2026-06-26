# PD Investigation Dashboard - Hosting Guide

Since the data files reside on the Amazon internal network drive (`\\\\ant.amazon.com\\...`), you cannot host this dashboard on public platforms like Vercel. However, you can easily host it on your local system or a shared team VM so that other systems on the network can use it.

Follow the steps below to make the dashboard accessible to other systems:

---

## Step 1: Run the Server on the Host Machine

On the machine where the code is located:
1. Open PowerShell or Command Prompt in the `DashBoard` directory.
2. Start the server by running:
   ```bash
   npm start
   ```
3. Make sure the server starts successfully and displays:
   ```
   ==================================================
    PD Investigation Dashboard Backend Running
    Port:    http://localhost:3000
   ==================================================
   ```

---

## Step 2: Find the Host Machine's IP Address

To allow other computers to connect, they need your computer's IP address:
1. Open a new PowerShell/Command Prompt window on the host machine.
2. Run the command:
   ```powershell
   ipconfig
   ```
3. Look for the **IPv4 Address** under your active network adapter (usually named *Wireless LAN adapter Wi-Fi* or *Ethernet adapter*).
   - It will look like: `10.x.x.x` or `192.168.x.x`.
   - Copy this IP address (e.g., `10.21.34.85`).

---

## Step 3: Access from Other Systems

On any other computer:
1. Ensure the computer is connected to the **Amazon network** (either in-office or via Amazon VPN).
2. Open a web browser (Chrome, Edge, etc.).
3. Navigate to:
   ```
   http://<YOUR_IP_ADDRESS>:3000
   ```
   *(Replace `<YOUR_IP_ADDRESS>` with the IP you found in Step 2, e.g., `http://10.21.34.85:3000`)*

---

## Step 4: Troubleshooting (Firewall Issues)

If the page does not load on other systems, Windows Firewall on your host computer might be blocking incoming traffic on port `3000`. 

To allow other computers to connect:
1. Press the **Windows Key**, type **Windows Defender Firewall with Advanced Security**, and press Enter.
2. In the left panel, click on **Inbound Rules**.
3. In the right panel, click on **New Rule...**
4. Choose **Port** and click **Next**.
5. Select **TCP** and enter `3000` in **Specific local ports**, then click **Next**.
6. Select **Allow the connection** and click **Next**.
7. Keep all checkboxes ticked (Domain, Private, Public) and click **Next**.
8. Name the rule `PD Dashboard` and click **Finish**.

Now, other computers on the VPN/network will be able to connect instantly!
