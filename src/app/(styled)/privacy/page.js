import { siteTitle, adminUserEmails, showAdminEmails } from '@src/utils/config'
import Link from 'next/link'

export const metadata = {
  title: `Privacy Policy - ${siteTitle}`,
  description: 'Privacy policy for this NextJS-Stream instance',
}

export default function PrivacyPolicy() {
  const hasAdminEmail = adminUserEmails && adminUserEmails.length > 0 && showAdminEmails
  const adminEmail = hasAdminEmail ? adminUserEmails[0] : null
  const currentDate = new Date().toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: '2-digit', 
    day: '2-digit' 
  })

  return (
    <div className="container mx-auto px-12 py-8 max-w-4xl bg-gray-800">
      <div className="prose prose-lg max-w-none dark:prose-invert">
        <h1 className="text-3xl font-bold mb-6">Privacy Policy</h1>
        
        <p className="text-sm text-gray-300 mb-8">
          <strong>Last Updated:</strong> {currentDate}
        </p>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">Introduction</h2>
          <p className="mb-4">
            {siteTitle} is a self-hosted media streaming application that allows users to stream and manage their personal media collections. 
            This privacy policy explains how personal information is collected, used, and protected when you use this instance of NextJS-Stream.
          </p>
          <div className="bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-400 p-4 mb-4">
            <p className="text-sm">
              <strong>Important Note:</strong> NextJS-Stream is open-source software designed to be self-hosted. 
              This instance is operated independently by the instance administrator. The data handling practices described 
              here are specific to this installation.
            </p>
          </div>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">Data Controller</h2>
          <p className="mb-4">
            The data controller for your personal information is the administrator of this NextJS-Stream instance, 
            not the developers of the NextJS-Stream software. For questions about your data, please contact the 
            instance administrator{hasAdminEmail ? ` at: ${adminEmail}` : '.'}
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">Information We Collect</h2>
          
          <h3 className="text-xl font-medium mb-3">1. Authentication Information</h3>
          <ul className="list-disc pl-6 mb-4">
            <li><strong>OAuth Data:</strong> When you sign in using Google or Discord, we collect your email address, name, and profile picture as provided by these services</li>
            <li><strong>Account Status:</strong> Information about your account approval status and access permissions</li>
            <li><strong>Session Data:</strong> Authentication sessions and login timestamps</li>
          </ul>

          <h3 className="text-xl font-medium mb-3">2. Watch History and Playback Data</h3>
          <ul className="list-disc pl-6 mb-4">
            <li><strong>Viewing Activity:</strong> Records of what media you watch, when you watch it, and your playback progress</li>
            <li><strong>Playback Position:</strong> Your current position in movies and TV episodes to enable resume functionality</li>
            <li><strong>Device Information:</strong> Basic information about devices used for authentication (TV, mobile apps)</li>
          </ul>

          <h3 className="text-xl font-medium mb-3">3. TV and Mobile Authentication</h3>
          <ul className="list-disc pl-6 mb-4">
            <li><strong>Authentication Tokens:</strong> Temporary tokens used for TV and mobile device login (expire within 5 minutes)</li>
            <li><strong>Session Coordination:</strong> Data to coordinate authentication across multiple devices</li>
            <li><strong>Device Sessions:</strong> Information about active sessions on different devices</li>
          </ul>

          <h3 className="text-xl font-medium mb-3">4. System Data</h3>
          <ul className="list-disc pl-6 mb-4">
            <li><strong>Notifications:</strong> System notifications about new content and updates</li>
            <li><strong>User Preferences:</strong> Settings and preferences you configure within the application</li>
            <li><strong>Administrative Logs:</strong> Records of administrative actions (for admin users only)</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">How We Use Your Information</h2>
          
          <h3 className="text-xl font-medium mb-3">Primary Functions</h3>
          <ul className="list-disc pl-6 mb-4">
            <li><strong>Authentication:</strong> To verify your identity and manage your account access</li>
            <li><strong>Media Streaming:</strong> To provide media streaming services and track playback progress</li>
            <li><strong>Cross-Device Sync:</strong> To synchronize your watch history and preferences across devices</li>
            <li><strong>Content Management:</strong> To organize and present your media library</li>
          </ul>

          <h3 className="text-xl font-medium mb-3">Administrative Functions</h3>
          <ul className="list-disc pl-6 mb-4">
            <li><strong>Access Control:</strong> To manage user permissions and account approvals</li>
            <li><strong>System Maintenance:</strong> To maintain system functionality and troubleshoot issues</li>
            <li><strong>Security:</strong> To protect against unauthorized access and abuse</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">Data Storage and Security</h2>
          
          <h3 className="text-xl font-medium mb-3">Storage Location</h3>
          <ul className="list-disc pl-6 mb-4">
            <li><strong>Database:</strong> Your data is stored in a MongoDB database on this server instance</li>
            <li><strong>Local Storage:</strong> Temporary playback data may be stored in your browser's local storage</li>
            <li><strong>Server Location:</strong> Data is stored on the server operated by this instance administrator</li>
          </ul>

          <h3 className="text-xl font-medium mb-3">Security Measures</h3>
          <ul className="list-disc pl-6 mb-4">
            <li><strong>Authentication:</strong> Secure OAuth-based authentication with major providers</li>
            <li><strong>Session Management:</strong> Secure session handling with automatic expiration</li>
            <li><strong>Access Control:</strong> Admin-controlled user approval system</li>
            <li><strong>Token Security:</strong> Short-lived authentication tokens with automatic cleanup</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">Data Sharing and Third Parties</h2>
          
          <h3 className="text-xl font-medium mb-3">No Third-Party Sharing</h3>
          <p className="mb-4">
            This NextJS-Stream instance does not share your personal data with third parties. Your data remains on this server instance.
          </p>

          <h3 className="text-xl font-medium mb-3">Optional External Services</h3>
          <p className="mb-2">This instance may be configured to use optional external services:</p>
          <ul className="list-disc pl-6 mb-4">
            <li><strong>TMDB/OMDB APIs:</strong> For movie and TV show metadata (no personal data shared)</li>
            <li><strong>Media Management Tools:</strong> Integration with Radarr, Sonarr, or similar tools (admin-configured)</li>
          </ul>

          <h3 className="text-xl font-medium mb-3">OAuth Providers</h3>
          <p className="mb-4">
            When you authenticate using Google or Discord, these services provide your basic profile information 
            directly to this NextJS-Stream instance according to their own privacy policies.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">Your Rights and Choices</h2>
          
          <h3 className="text-xl font-medium mb-3">Access and Control</h3>
          <ul className="list-disc pl-6 mb-4">
            <li><strong>Account Access:</strong> You can view your account information through the application interface</li>
            <li><strong>Watch History:</strong> Your viewing history is accessible through your user profile</li>
            <li><strong>Session Management:</strong> You can manage active sessions and logout from devices</li>
          </ul>

          <h3 className="text-xl font-medium mb-3">Data Deletion</h3>
          <ul className="list-disc pl-6 mb-4">
            <li><strong>Account Deletion:</strong> You can request deletion of your account and associated data</li>
            <li><strong>Grace Period:</strong> Account deletion requests have a 30-day grace period before permanent deletion</li>
            <li><strong>Data Removal:</strong> Upon deletion, all your personal data, watch history, and preferences are permanently removed</li>
          </ul>

          <h3 className="text-xl font-medium mb-3">How to Exercise Your Rights</h3>
          <p className="mb-4">
            To exercise any of these rights, contact the instance administrator{hasAdminEmail ? ` at ${adminEmail}` : ''} or
            use the account deletion feature within the application.
          </p>
          
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-4">
            <h4 className="text-lg font-medium text-red-800 dark:text-red-200 mb-2">
              Request Account Deletion
            </h4>
            <p className="text-sm text-red-700 dark:text-red-300 mb-3">
              You can request permanent deletion of your account and all associated personal data.
              This action is irreversible after the 30-day grace period.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <Link
                href="/privacy/delete-account"
                className="inline-flex items-center justify-center rounded-md border border-transparent bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
              >
                Request Account Deletion
              </Link>
              <span className="text-xs text-red-600 dark:text-red-400 self-center">
                Available for both authenticated and non-authenticated users
              </span>
            </div>
          </div>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">Data Retention</h2>
          
          <h3 className="text-xl font-medium mb-3">Active Data</h3>
          <ul className="list-disc pl-6 mb-4">
            <li><strong>Account Information:</strong> Retained while your account is active</li>
            <li><strong>Watch History:</strong> Retained to provide resume functionality and viewing history</li>
            <li><strong>Session Data:</strong> Automatically cleaned up based on expiration times</li>
          </ul>

          <h3 className="text-xl font-medium mb-3">Deleted Data</h3>
          <ul className="list-disc pl-6 mb-4">
            <li><strong>Account Deletion:</strong> All personal data is permanently deleted after the 30-day grace period</li>
            <li><strong>Inactive Accounts:</strong> Retention policy determined by instance administrator</li>
            <li><strong>Logs:</strong> Administrative logs may be retained for system maintenance purposes</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">International Data Transfers</h2>
          <p className="mb-4">
            Since NextJS-Stream is self-hosted, your data remains on this server instance. The location of this server 
            determines the jurisdiction under which your data is processed.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">Compliance with Privacy Laws</h2>
          
          <h3 className="text-xl font-medium mb-3">GDPR (European Union)</h3>
          <p className="mb-2">If you are located in the EU, you have additional rights under the General Data Protection Regulation:</p>
          <ul className="list-disc pl-6 mb-4">
            <li><strong>Right to Access:</strong> Request a copy of your personal data</li>
            <li><strong>Right to Rectification:</strong> Request correction of inaccurate data</li>
            <li><strong>Right to Erasure:</strong> Request deletion of your personal data</li>
            <li><strong>Right to Portability:</strong> Request transfer of your data in a structured format</li>
            <li><strong>Right to Object:</strong> Object to processing of your personal data</li>
          </ul>

          <h3 className="text-xl font-medium mb-3">CCPA (California)</h3>
          <p className="mb-2">If you are a California resident, you have rights under the California Consumer Privacy Act:</p>
          <ul className="list-disc pl-6 mb-4">
            <li><strong>Right to Know:</strong> Request information about data collection and use</li>
            <li><strong>Right to Delete:</strong> Request deletion of your personal data</li>
            <li><strong>Right to Opt-Out:</strong> Opt-out of the sale of personal information (Note: This instance does not sell personal information)</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">Children's Privacy</h2>
          <p className="mb-4">
            This NextJS-Stream instance is not intended for use by children under 13 years of age. We do not knowingly 
            collect personal information from children under 13. If you become aware that a child has provided personal 
            information, please contact the instance administrator.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">Changes to This Privacy Policy</h2>
          <p className="mb-4">
            This privacy policy may be updated from time to time. The instance administrator is responsible for notifying 
            users of any material changes. The "Last Updated" date at the top of this policy indicates when it was last revised.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">Contact Information</h2>
          <p className="mb-4">
            For questions, concerns, or requests regarding this privacy policy or your personal data, please contact:
          </p>
          <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
            {hasAdminEmail ? (
              <p><strong>Instance Administrator:</strong> {adminEmail}</p>
            ) : (
              <p><strong>Instance Administrator:</strong> Contact your system administrator</p>
            )}
            <p><strong>Instance:</strong> {siteTitle}</p>
          </div>
        </section>
      </div>
    </div>
  )
}
