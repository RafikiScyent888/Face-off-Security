"""Topic categories for the acronym banks that do not carry any.

Network+'s acronym repo ships a `category` on every entry, and those become
the board's column headings. The A+, Security+ and CySA+ banks carry only
{id, acronym, expansion, definition} — their own READMEs list categories as
a wanted future addition — so a board built straight from them showed four
identical headings.

These are those categories, written out. Two rules make this safe to live
with:

  1. It is keyed by ACRONYM, so it says nothing about wording and does not
     drift when a definition is reworded.
  2. The build FAILS and names every unclassified acronym. A table keyed by
     item that does not grow with the items is the single most repeated
     fault in this whole program; this one cannot rot quietly.

An acronym may be listed once. Where the same letters mean two things
(SPICE on A+, MAC on Security+) both meanings live in whichever category
fits, and the builder's ambiguity handling makes the clue say which is
wanted.
"""

TOPICS = {}

# ---------------------------------------------------------------- A+ 1201/1202
# One combined list covers both Core 1 and Core 2, which is how CompTIA
# publishes it, so both games are built from the whole 202.
TOPICS["aplus"] = {
    "PROCESSORS, MEMORY & BOARDS": [
        "CPU", "RAM", "DIMM", "SODIMM", "DDR", "ECC", "CAS", "VRAM",
        "ATX", "ITX", "PCI", "PCIe", "GPU", "ARM", "RISC", "AMD",
        "BIOS", "CMOS", "UEFI", "POST", "PC", "OEM",
    ],
    "STORAGE": [
        "HDD", "SSD", "NVMe", "SATA", "eSATA", "mSATA", "SAS", "SCSI",
        "RAID", "NAS", "SAN", "SDS", "IOPS", "RPM", "S.M.A.R.T", "SD",
        "MBR", "GPT",
    ],
    "FILE SYSTEMS & SHARES": [
        "NTFS", "FAT32", "exFAT", "APFS", "ReFS", "XFS", "EFS", "CIFS", "SMB",
    ],
    "DISPLAYS & VIDEO": [
        "LCD", "LED", "OLED", "IPS", "TN", "VA", "HD", "RGB",
        "VGA", "DVI", "HDMI", "KVM",
    ],
    "CABLES, PORTS & CONNECTORS": [
        "USB", "USB-C", "DB-9", "BNC", "RJ11", "RJ45", "LC", "SC", "ST",
        "PoE", "IR", "NFC",
    ],
    "PRINTERS": ["ADF", "MFP", "PCL"],
    "NETWORK FUNDAMENTALS": [
        "IP", "TCP", "UDP", "DNS", "DHCP", "NAT", "APIPA", "MAC", "NIC",
        "LAN", "WAN", "MAN", "PAN", "VLAN", "QoS", "NTP", "NetBIOS",
        "CNAME", "MX", "TXT", "SOHO",
    ],
    "WIRELESS & MOBILE": [
        "AP", "WAP", "WLAN", "WWAN", "WISP", "WEP", "WPA", "TKIP", "SSID",
        "LTE", "GPS", "SIM", "eSIM", "SMS", "MDM", "BYOD", "RFID",
    ],
    "INTERNET & REMOTE ACCESS": [
        "ISP", "DSL", "ONT", "HTTP", "HTTPS", "FTP", "SFTP", "SSH", "RDP",
        "VNC", "VPN", "VoIP", "SNMP", "IMAP", "POP", "SMTP", "LDAP",
        "UPnP", "WinRM", "RMM", "PXE",
        # SPICE means two unrelated things on A+; this is the remote-desktop one
        "SPICE = Simple Protocol for Independent Computing Environments (1202)",
    ],
    "OPERATING SYSTEMS & TOOLS": [
        "OS", "GUI", "MMC", "UAC", "SQL", "VM", "VDI", "GUID",
    ],
    "CLOUD": ["IaaS", "PaaS", "SaaS", "FaaS", "XaaS"],
    "IDENTITY & ACCESS": [
        "AAA", "ACL", "IAM", "MFA", "OTP", "TOTP", "PIN", "PIV", "CAC",
        "SSO", "SAML", "RADIUS", "TACACS", "NAC", "PAM",
    ],
    "SECURITY CONTROLS": [
        "AES", "HSM", "DLP", "EDR", "XDR", "MDR", "UTM", "DRM", "TPM",
        "SPF", "DKIM", "DMARC", "FRT",
    ],
    "THREATS & FAILURES": [
        "DOS", "DDOS", "XSS", "PUP", "BSOD", "BEC",
    ],
    "POLICY, SAFETY & OPERATIONS": [
        "AUP", "EULA", "NDA", "MNDA", "SLA", "SOP", "PII", "MSDS", "ESD",
        "EOL", "CMDB", "GFS", "ISO", "UPS", "PSU", "RSR", "IoT", "SCADA",
        # ...and this is the process-maturity one
        "SPICE = Software Process Improvement and Capability Determination (1201)",
    ],
}


# ---------------------------------------------------------------- Security+ SY0-701
# The bank deliberately carries the same letters more than once — MAC three
# times, PAM, RA, RBAC and SAN twice each — so those are filed by meaning.
TOPICS["security"] = {
    "CRYPTOGRAPHY": [
        "3DES", "AES", "AES-256", "CBC", "CCMP", "CFB", "DES", "DHE", "DSA",
        "ECB", "ECC", "ECDHE", "ECDSA", "GCM", "GPG", "HMAC", "IDEA", "IV",
        "KEK", "MD5", "PBKDF2", "PFS", "PGP", "PKCS", "RC4", "RIPEMD", "RSA",
        "SHA", "S/MIME", "XOR", "CTM", "CRC",
        "MAC = Message Authentication Code",
    ],
    "CERTIFICATES & PKI": [
        "CA", "CRL", "CSR", "OCSP", "P12", "PEM", "PKI", "SCEP", "OID", "TSIG",
        "RA = Registration Authority", "RA = Recovery Agent",
        "SAN = Subject Alternative Name",
    ],
    "IDENTITY & ACCESS": [
        "2FA", "AAA", "ACL", "CHAP", "DAC", "FACL", "HOTP", "IAM", "IdP",
        "KDC", "LDAP", "MFA", "MSCHAP", "NTLM", "OAUTH", "PAP", "PIV",
        "SAML", "SSO", "TACACS+", "TGT", "TOTP", "RADIUS", "EAP", "LEAP",
        "PEAP", "PSK", "SAE", "FRR",
        "MAC = Mandatory Access Control",
        "PAM = Privileged Access Management",
        "PAM = Pluggable Authentication Modules",
        "RBAC = Role-based Access Control",
        "RBAC = Rule-based Access Control",
    ],
    "NETWORK PROTOCOLS & ADDRESSING": [
        "ARP", "BGP", "DHCP", "DNS", "DNSSEC", "GRE", "ICMP", "IP", "IPSec",
        "L2TP", "MPLS", "MTU", "NAT", "DNAT", "PAT", "OSPF", "PPP", "PPTP",
        "TCP/IP", "UDP", "VLSM", "VLAN", "SDN", "SD-WAN", "VPC", "IKE", "AH",
        "ESP", "LAN", "MAN", "NTP", "BPDU", "IEEE",
        "MAC = Media Access Control",
    ],
    "NETWORK SECURITY DEVICES": [
        "NGFW", "WAF", "SWG", "UTM", "IDS", "IPS", "HIDS", "HIPS", "NIDS",
        "NIPS", "WIDS", "WIPS", "NAC", "CASB", "SASE", "RTBH", "VPN", "RAS",
    ],
    "WIRELESS & MOBILE": [
        "AP", "WAP", "WEP", "WPA", "WPS", "TKIP", "WTLS", "RFID", "NFC",
        "OTA", "MMS", "SMS", "SIM", "ESN", "GPS", "UAV",
    ],
    "APPLICATION & WEB SECURITY": [
        "API", "ASLR", "CAPTCHA", "CSRF", "XSRF", "XSS", "SQLi", "SQL",
        "SOAP", "HTML", "XML", "URI", "URL", "SDK", "SDLC", "SDLM", "DEP",
        "SEH", "DLL", "VBA", "BASH", "IaC", "UAT", "SHTTP",
    ],
    "TRANSPORT & SERVICE PROTOCOLS": [
        "FTP", "FTPS", "SFTP", "HTTP", "HTTPS", "IMAP", "POP", "SMTP",
        "SMTPS", "SSH", "SSL", "TLS", "SMB", "SNMP", "RDP", "RTP", "SRTP",
        "IRC", "IM", "VoIP", "VTC", "POTS", "CSU", "DSL", "ISP", "PBX", "PAC",
        "DKIM", "DMARC", "SPF",
    ],
    "THREATS & ATTACKS": [
        "APT", "ATT&CK", "AV", "DDoS", "DoS", "IoC", "OSINT", "PUP", "RAT",
        "SPIM", "TTP", "CVE", "CVSS", "OVAL", "STIX", "TAXII", "AIS", "SCAP",
    ],
    "MONITORING & RESPONSE": [
        "SIEM", "SOAR", "SOC", "CERT", "CIRT", "IRP", "IR", "EDR", "XDR",
        "UBA", "FIM", "PCAP", "MTBF", "MTTF", "MTTR", "HA",
    ],
    "RISK & CONTINUITY": [
        "ALE", "ARO", "SLE", "BIA", "BCP", "COOP", "DRP", "RPO", "RTO",
        "ROI", "CIA", "CP", "CAR", "RACE",
    ],
    "GOVERNANCE & AGREEMENTS": [
        "GDPR", "ISO", "NIST", "PCI DSS", "PHI", "PII", "AUP", "EULA", "NDA",
        "MOA", "MOU", "MSA", "BPA", "SOW", "SLA", "WO", "TOU", "TOC", "DPO",
        "ISSO", "CIO", "CSO", "CTO", "DBA", "MSP", "MSSP", "ERP", "CMS",
    ],
    "HARDWARE & PHYSICAL SECURITY": [
        "BIOS", "UEFI", "HDD", "SSD", "SED", "FDE", "HSM", "TPM", "GPU",
        "FPGA", "RAID", "UPS", "HVAC", "CCTV", "PTZ", "PED", "MBR", "PDU",
        "IDF", "MDF", "USB", "USB OTG", "UTP", "SoC", "RTOS", "MFD", "MFP",
        "SAN = Storage Area Network",
    ],
    "ENDPOINT & DEVICE MANAGEMENT": [
        "BYOD", "COBO", "COPE", "CYOD", "MDM", "UEM", "SELinux", "GPO",
        "NTFS", "EFS", "OS", "P2P", "DLP",
    ],
    "CLOUD & VIRTUALIZATION": [
        "IaaS", "PaaS", "SaaS", "MaaS", "CSP", "VDI", "VDE", "VM", "AI",
        "ML", "RAD",
    ],
    "INDUSTRIAL & EMBEDDED": ["ICS", "OT", "SCADA", "IoT"],
}


# ---------------------------------------------------------------- CySA+ CS0-003
# Analyst-facing: the columns follow what an analyst actually does — read
# intelligence, triage alerts, test applications, respond to incidents.
TOPICS["cysa"] = {
    "THREAT INTELLIGENCE": [
        "APT", "ATT&CK", "IoC", "OSINT", "STIX", "TTP", "C2", "CVE", "CVSS",
        "OSVDB", "POC",
    ],
    "DETECTION & MONITORING": [
        "SIEM", "SOAR", "SOC", "NOC", "IDS", "IPS", "HIDS", "HIPS", "NIDS",
        "NIPS", "EDR", "XDR", "UEBA", "FIM", "AV", "MTTD",
    ],
    "INCIDENT RESPONSE & FORENSICS": [
        "IR", "CERT", "CSIRT", "FTK", "GDB", "LSASS", "PID", "EOF", "DR",
        "BC", "BCP", "RPO", "RTO", "BIA",
    ],
    "VULNERABILITY MANAGEMENT": [
        "OpenVAS", "ZAP", "MSF", "SAST", "DAST", "ASVS", "OSSTMM", "OWASP",
        "SAMM", "DEP",
    ],
    "WEB & APPLICATION ATTACKS": [
        "XSS", "RXSS", "CSRF", "SSRF", "SQLi", "RCE", "RFI", "LFI", "IDOR",
        "XXE", "BEAST", "BREACH", "TRACE", "DoS", "DDoS",
    ],
    "APPLICATION & DEVELOPMENT": [
        "API", "REST", "SOAP", "JSON", "XML", "HTML", "PHP", "SQL", "SDLC",
        "CI/CD", "DLL", "IIS", "HTTPD", "MSRPC", "RPC", "CMS",
    ],
    "NETWORK PROTOCOLS": [
        "ARP", "BGP", "DHCP", "DNS", "DoH", "ICMP", "IP", "TCP", "UDP",
        "NTP", "SNMP", "SMB", "FTP", "TFTP", "SFTP", "SSH", "RDP", "SMTP",
        "LAN", "WAN", "VLAN", "URI", "URL", "MAC", "OUI", "SNI", "UTC",
    ],
    "ENCRYPTION & CERTIFICATES": [
        "CA", "PKI", "SSL", "TLS", "HTTPS", "HTTP", "MD5", "RSA", "CBC",
        "GPG", "LDAPS", "DKIM", "DMARC", "SPF",
    ],
    "IDENTITY & ACCESS": [
        "ACL", "IAM", "MFA", "SAML", "SSO", "RADIUS", "PAM", "NAC", "GPO",
        "ZTA", "ZTNA",
    ],
    "NETWORK SECURITY DEVICES": [
        "NGFW", "WAF", "SWG", "CASB", "SASE", "SDN", "CDN", "VPN", "SSID",
    ],
    "CLOUD & VIRTUALIZATION": ["IaaS", "SaaS", "VM", "MSP", "MSSP", "ISP"],
    "GOVERNANCE & FRAMEWORKS": [
        "NIST", "ISO", "CIS", "CSF", "COBIT", "ITIL", "PCI DSS",
        "SLA", "SLO", "KPI", "LOI", "MOU", "NDA", "DLP", "PII", "CHD", "IT",
    ],
    "INDUSTRIAL & ENDPOINT": ["ICS", "OT", "SCADA", "PLC", "BIOS", "CPU", "OS", "USB", "SMS"],
}
