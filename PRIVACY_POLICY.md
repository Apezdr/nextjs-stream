# Privacy Policy for NextJS-Stream

**Last Updated:** 06/25/2025

## Introduction

NextJS-Stream is a self-hosted media streaming application that allows users to stream and manage their personal media collections. This privacy policy explains how personal information is collected, used, and protected when you use an instance of NextJS-Stream.

**Important Note:** NextJS-Stream is open-source software designed to be self-hosted. Each installation is operated independently by the instance administrator. This privacy policy serves as a template and guideline, but the actual data handling practices may vary depending on how each instance is configured and operated.

## Data Controller

The data controller for your personal information is the administrator of the specific NextJS-Stream instance you are using, not the developers of the NextJS-Stream software. For questions about your data, please contact your instance administrator.

## Information We Collect

### 1. Authentication Information
- **OAuth Data:** When you sign in using Google or Discord, we collect your email address, name, and profile picture as provided by these services
- **Account Status:** Information about your account approval status and access permissions
- **Session Data:** Authentication sessions and login timestamps

### 2. Watch History and Playback Data
- **Viewing Activity:** Records of what media you watch, when you watch it, and your playback progress
- **Playback Position:** Your current position in movies and TV episodes to enable resume functionality
- **Device Information:** Basic information about devices used for authentication (TV, mobile apps)

### 3. TV and Mobile Authentication
- **Authentication Tokens:** Temporary tokens used for TV and mobile device login (expire within 5 minutes)
- **Session Coordination:** Data to coordinate authentication across multiple devices
- **Device Sessions:** Information about active sessions on different devices

### 4. System Data
- **Notifications:** System notifications about new content and updates
- **User Preferences:** Settings and preferences you configure within the application
- **Administrative Logs:** Records of administrative actions (for admin users only)

## How We Use Your Information

We use your personal information for the following purposes:

### Primary Functions
- **Authentication:** To verify your identity and manage your account access
- **Media Streaming:** To provide media streaming services and track playback progress
- **Cross-Device Sync:** To synchronize your watch history and preferences across devices
- **Content Management:** To organize and present your media library

### Administrative Functions
- **Access Control:** To manage user permissions and account approvals
- **System Maintenance:** To maintain system functionality and troubleshoot issues
- **Security:** To protect against unauthorized access and abuse

## Data Storage and Security

### Storage Location
- **Database:** Your data is stored in a MongoDB database on the server hosting your NextJS-Stream instance
- **Local Storage:** Temporary playback data may be stored in your browser's local storage
- **Server Location:** Data is stored on the server operated by your instance administrator

### Security Measures
- **Authentication:** Secure OAuth-based authentication with major providers
- **Session Management:** Secure session handling with automatic expiration
- **Access Control:** Admin-controlled user approval system
- **Token Security:** Short-lived authentication tokens with automatic cleanup

## Data Sharing and Third Parties

### No Third-Party Sharing
NextJS-Stream does not share your personal data with third parties. Your data remains on the server instance you're using.

### Optional External Services
Some instances may be configured to use optional external services:
- **TMDB/OMDB APIs:** For movie and TV show metadata (no personal data shared)
- **Media Management Tools:** Integration with Radarr, Sonarr, or similar tools (admin-configured)

### OAuth Providers
When you authenticate using Google or Discord, these services provide your basic profile information directly to the NextJS-Stream instance according to their own privacy policies.

## Your Rights and Choices

### Access and Control
- **Account Access:** You can view your account information through the application interface
- **Watch History:** Your viewing history is accessible through your user profile
- **Session Management:** You can manage active sessions and logout from devices

### Data Deletion
- **Account Deletion:** You can request deletion of your account and associated data
- **Grace Period:** Account deletion requests have a 30-day grace period before permanent deletion
- **Data Removal:** Upon deletion, all your personal data, watch history, and preferences are permanently removed

### How to Exercise Your Rights
To exercise any of these rights, contact your instance administrator or use the account deletion feature within the application.

## Data Retention

### Active Data
- **Account Information:** Retained while your account is active
- **Watch History:** Retained to provide resume functionality and viewing history
- **Session Data:** Automatically cleaned up based on expiration times

### Deleted Data
- **Account Deletion:** All personal data is permanently deleted after the 30-day grace period
- **Inactive Accounts:** Retention policy determined by instance administrator
- **Logs:** Administrative logs may be retained for system maintenance purposes

## International Data Transfers

Since NextJS-Stream is self-hosted, your data remains on the server operated by your instance administrator. The location of this server determines the jurisdiction under which your data is processed.

## Compliance with Privacy Laws

### GDPR (European Union)
If you are located in the EU, you have additional rights under the General Data Protection Regulation:
- **Right to Access:** Request a copy of your personal data
- **Right to Rectification:** Request correction of inaccurate data
- **Right to Erasure:** Request deletion of your personal data
- **Right to Portability:** Request transfer of your data in a structured format
- **Right to Object:** Object to processing of your personal data

### CCPA (California)
If you are a California resident, you have rights under the California Consumer Privacy Act:
- **Right to Know:** Request information about data collection and use
- **Right to Delete:** Request deletion of your personal data
- **Right to Opt-Out:** Opt-out of the sale of personal information (Note: NextJS-Stream does not sell personal information)

## Children's Privacy

NextJS-Stream is not intended for use by children under 13 years of age. We do not knowingly collect personal information from children under 13. If you become aware that a child has provided personal information, please contact the instance administrator.

## Changes to This Privacy Policy

This privacy policy may be updated from time to time. The instance administrator is responsible for notifying users of any material changes. The "Last Updated" date at the top of this policy indicates when it was last revised.

## Contact Information

For questions, concerns, or requests regarding this privacy policy or your personal data, please contact:

**Instance Administrator:** [ADMIN_EMAIL]  
**Instance URL:** [INSTANCE_URL]

---

## For Instance Administrators

If you are operating a NextJS-Stream instance, please customize this privacy policy by:

1. Replacing `[DATE]` with the current date
2. Replacing `[ADMIN_EMAIL]` with your contact email
3. Replacing `[INSTANCE_URL]` with your instance URL
4. Adding any additional data processing activities specific to your instance
5. Ensuring compliance with local privacy laws in your jurisdiction

This privacy policy template is based on the actual data handling practices implemented in the NextJS-Stream codebase and should be reviewed regularly to ensure accuracy and compliance.
