# Security Policy

## Security Commitments

At PrasaTek System Solutions, we prioritize the security and integrity of our inventory management system. This document outlines our security policies, vulnerability reporting processes, and active security measures.

## Reporting a Vulnerability

If you identify a security vulnerability within this system, please do not disclose it publicly. Contact the system administrator directly so we can resolve the issue:

- **Contact**: PrasaTek System Solutions Support
- **Reporting Email**: security@prasatekcomputer.lk

Please include details of the vulnerability, steps to reproduce it, and any potential impact in your report. We aim to acknowledge reports within 48 hours and provide updates throughout the resolution process.

## Active Security Measures

The system incorporates several native backend and frontend security protections:

1. **Role-Based Access Control (RBAC)**:
   - Operators are restricted based on tick-mark access clearances configured in the User Directory.
   - Core administrative actions are restricted strictly to accounts with the `admin` role.

2. **Administrator Account Protections**:
   - **Deletion Barrier**: Delete requests targeting any account with the `admin` role are blocked globally at both the API and UI levels.
   - **Modification Barrier**: Only authenticated administrators can edit administrator account settings, roles, or passwords.
   - **Role Elevation Prevention**: Non-admins are blocked from assigning the `admin` role to standard users.

3. **Brute-Force & Rate Limiting**:
   - An active rate-limiting middleware restricts login attempts to a maximum of 10 requests per minute per IP address. Additional requests are rejected with HTTP status `429 Too Many Requests`.

4. **HTTP Security Hardening Headers**:
   - The backend server injects security headers in all API responses to protect against standard web vectors:
     - `X-Content-Type-Options: nosniff` (Prevents MIME type sniffing)
     - `X-Frame-Options: DENY` (Blocks clickjacking attacks)
     - `X-XSS-Protection: 1; mode=block` (Enables browser XSS filtering)
     - `Referrer-Policy: no-referrer` (Prevents leaking query parameters)

5. **Token Authentication**:
   - Access to private endpoints requires JSON Web Token (JWT) verification via the `Authorization: Bearer <token>` header. Tokens expire after 24 hours.
