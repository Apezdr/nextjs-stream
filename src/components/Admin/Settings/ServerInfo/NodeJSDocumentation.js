function NodeJSDocumentation({ nodeJSURL }) {
  return (
    <div className="space-y-6 p-4">
      {/* Overview Section */}
      <div>
        <h3 className="text-xl font-semibold text-gray-800">📄 NodeJS Service Documentation</h3>
        <p className="mt-2 text-gray-600">
          The <span className="font-bold">NodeJS Service</span> serves as the backbone of your media
          management system, handling backend operations such as media processing, caching, and
          synchronization. It exposes a variety of endpoints to manage and retrieve media content
          like movies and TV shows efficiently.
        </p>
      </div>

      {/* Base URL Section */}
      <div>
        <h4 className="text-lg font-medium text-gray-700">🔗 Base URL</h4>
        <p className="mt-1 text-gray-600">
          All endpoints are accessible via the <span className="font-semibold">NodeJS URL</span>{' '}
          you've configured in your server settings.
        </p>
        <pre className="mt-2 p-2 bg-gray-100 rounded text-sm text-gray-800">{nodeJSURL}</pre>
      </div>

      {/* Table of Contents */}
      <div>
        <h4 className="text-lg font-medium text-gray-700">📂 Table of Contents</h4>
        <ol className="list-decimal list-inside mt-2 space-y-1 text-gray-600">
          <li>Frame Endpoints</li>
          <li>Sprite Sheet Endpoints</li>
          <li>VTT File Endpoints</li>
          <li>Chapter File Endpoints</li>
          <li>Video Endpoints</li>
          <li>Media Library Endpoints</li>
          <li>Utility Endpoints</li>
          <li>Additional Information</li>
        </ol>
      </div>

      {/* Frame Endpoints Section */}
      <div>
        <h4 className="text-lg font-medium text-gray-700">1. Frame Endpoints</h4>
        <div className="mt-2 space-y-4">
          {/* Get Movie Frame */}
          <div>
            <h5 className="text-md font-semibold text-gray-700">a. Get Movie Frame</h5>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">Endpoint:</span>{' '}
              <code>GET /frame/movie/:movieName/:timestamp.:ext?</code>
            </p>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">Description:</span> Retrieves a specific frame from a
              movie at the given timestamp.
            </p>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">Parameters:</span>
            </p>
            <ul className="list-disc list-inside ml-4 text-gray-600">
              <li>
                <code>:movieName</code> (string) – The name of the movie.
              </li>
              <li>
                <code>:timestamp</code> (string) – The timestamp in <code>HH:MM:SS</code> format.
              </li>
              <li>
                <code>:ext</code> (optional, string) – Image extension (e.g., <code>jpg</code>,{' '}
                <code>png</code>, <code>avif</code>).
              </li>
            </ul>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">Example Request:</span>
            </p>
            <pre className="mt-1 p-2 bg-gray-100 rounded text-sm text-gray-800 w-fit">
              GET {nodeJSURL}/frame/movie/Inception/00:45:30.jpg
            </pre>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">Response:</span> Returns the requested frame image.
            </p>
          </div>

          {/* Get TV Show Frame */}
          <div>
            <h5 className="text-md font-semibold text-gray-700">b. Get TV Show Frame</h5>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">Endpoint:</span>{' '}
              <code>GET /frame/tv/:showName/:season/:episode/:timestamp.:ext?</code>
            </p>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">Description:</span> Retrieves a specific frame from a
              TV show episode at the given timestamp.
            </p>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">Parameters:</span>
            </p>
            <ul className="list-disc list-inside ml-4 text-gray-600">
              <li>
                <code>:showName</code> (string) – The name of the TV show.
              </li>
              <li>
                <code>:season</code> (string) – The season number.
              </li>
              <li>
                <code>:episode</code> (string) – The episode number.
              </li>
              <li>
                <code>:timestamp</code> (string) – The timestamp in <code>HH:MM:SS</code> format.
              </li>
              <li>
                <code>:ext</code> (optional, string) – Image extension (e.g., <code>jpg</code>,{' '}
                <code>png</code>, <code>avif</code>).
              </li>
            </ul>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">Example Request:</span>
            </p>
            <pre className="mt-1 p-2 bg-gray-100 rounded text-sm text-gray-800 w-fit">
              GET {nodeJSURL}/frame/tv/Breaking%20Bad/1/1/00:30:00.avif
            </pre>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">Response:</span> Returns the requested frame image.
            </p>
          </div>
        </div>
      </div>

      {/* Sprite Sheet Endpoints Section */}
      <div>
        <h4 className="text-lg font-medium text-gray-700">2. Sprite Sheet Endpoints</h4>
        <div className="mt-2 space-y-4">
          {/* Get Movie Sprite Sheet */}
          <div>
            <h5 className="text-md font-semibold text-gray-700">a. Get Movie Sprite Sheet</h5>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">Endpoint:</span>{' '}
              <code>GET /spritesheet/movie/:movieName</code>
            </p>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">Description:</span> Retrieves the sprite sheet for the
              specified movie.
            </p>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">Parameters:</span>
            </p>
            <ul className="list-disc list-inside ml-4 text-gray-600">
              <li>
                <code>:movieName</code> (string) – The name of the movie.
              </li>
            </ul>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">Example Request:</span>
            </p>
            <pre className="mt-1 p-2 bg-gray-100 rounded text-sm text-gray-800 w-fit">
              GET {nodeJSURL}/spritesheet/movie/Inception
            </pre>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">Response:</span> Returns the sprite sheet image.
            </p>
          </div>

          {/* Get TV Show Sprite Sheet */}
          <div>
            <h5 className="text-md font-semibold text-gray-700">b. Get TV Show Sprite Sheet</h5>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">Endpoint:</span>{' '}
              <code>GET /spritesheet/tv/:showName/:season/:episode</code>
            </p>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">Description:</span> Retrieves the sprite sheet for the
              specified TV show episode.
            </p>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">Parameters:</span>
            </p>
            <ul className="list-disc list-inside ml-4 text-gray-600">
              <li>
                <code>:showName</code> (string) – The name of the TV show.
              </li>
              <li>
                <code>:season</code> (string) – The season number.
              </li>
              <li>
                <code>:episode</code> (string) – The episode number.
              </li>
            </ul>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">Example Request:</span>
            </p>
            <pre className="mt-1 p-2 bg-gray-100 rounded text-sm text-gray-800 w-fit">
              GET {nodeJSURL}/spritesheet/tv/Breaking%20Bad/1/1
            </pre>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">Response:</span> Returns the sprite sheet image.
            </p>
          </div>
        </div>
      </div>

      {/* VTT File Endpoints Section */}
      <div>
        <h4 className="text-lg font-medium text-gray-700">3. VTT File Endpoints</h4>
        <div className="mt-2 space-y-4">
          {/* Get Movie VTT */}
          <div>
            <h5 className="text-md font-semibold text-gray-700">a. Get Movie VTT</h5>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">Endpoint:</span>{' '}
              <code>GET /vtt/movie/:movieName</code>
            </p>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">Description:</span> Retrieves the VTT (WebVTT) file
              containing subtitle or caption information for the specified movie.
            </p>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">Parameters:</span>
            </p>
            <ul className="list-disc list-inside ml-4 text-gray-600">
              <li>
                <code>:movieName</code> (string) – The name of the movie.
              </li>
            </ul>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">Example Request:</span>
            </p>
            <pre className="mt-1 p-2 bg-gray-100 rounded text-sm text-gray-800 w-fit">
              GET {nodeJSURL}/vtt/movie/Inception
            </pre>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">Response:</span> Returns the VTT file.
            </p>
          </div>

          {/* Get TV Show VTT */}
          <div>
            <h5 className="text-md font-semibold text-gray-700">b. Get TV Show VTT</h5>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">Endpoint:</span>{' '}
              <code>GET /vtt/tv/:showName/:season/:episode</code>
            </p>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">Description:</span> Retrieves the VTT (WebVTT) file
              for the specified TV show episode.
            </p>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">Parameters:</span>
            </p>
            <ul className="list-disc list-inside ml-4 text-gray-600">
              <li>
                <code>:showName</code> (string) – The name of the TV show.
              </li>
              <li>
                <code>:season</code> (string) – The season number.
              </li>
              <li>
                <code>:episode</code> (string) – The episode number.
              </li>
            </ul>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">Example Request:</span>
            </p>
            <pre className="mt-1 p-2 bg-gray-100 rounded text-sm text-gray-800 w-fit">
              GET {nodeJSURL}/vtt/tv/Breaking%20Bad/1/1
            </pre>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">Response:</span> Returns the VTT file.
            </p>
          </div>
        </div>
      </div>

      {/* Additional Sections */}
      {/* You can continue adding more sections following the same structure as above */}

      {/* Additional Information Section */}
      <div>
        <h4 className="text-lg font-medium text-gray-700">8. Additional Information</h4>
        <div className="mt-2 space-y-4">
          {/* Caching Mechanism */}
          <div>
            <h5 className="text-md font-semibold text-gray-700">🔄 Caching Mechanism</h5>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">Purpose:</span> Improves performance by storing
              generated frames, sprite sheets, and chapter files.
            </p>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">Behavior:</span> The service checks for existing
              cached files before generating new ones to reduce processing time and resource usage.
            </p>
          </div>

          {/* Scheduled Tasks */}
          <div>
            <h5 className="text-md font-semibold text-gray-700">🕒 Scheduled Tasks</h5>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">Cache Cleanup:</span> Periodically clears different
              cache directories to manage storage efficiently.
            </p>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">Poster Collage Generation:</span> Runs scripts to
              generate poster collages at specified intervals.
            </p>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">TMDB Image Downloads:</span> Regularly fetches and
              updates images from TMDB to keep media metadata current.
            </p>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">Media List Generation:</span> Continuously updates the
              media library by scanning directories and synchronizing with the database.
            </p>
          </div>

          {/* Security Considerations */}
          <div>
            <h5 className="text-md font-semibold text-gray-700">🔐 Security Considerations</h5>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">Access Control:</span> Ensure that the NodeJS service
              URL is protected and accessible only to authorized users within your network.
            </p>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">Environment Variables:</span> Sensitive information
              like <code>TMDB_API_KEY</code> and
              <code>WEBHOOK_ID</code> should be securely managed using environment variables.
            </p>
          </div>

          {/* Monitoring and Logging */}
          <div>
            <h5 className="text-md font-semibold text-gray-700">📈 Monitoring and Logging</h5>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">Logs:</span> The service logs important events and
              errors to help in monitoring and troubleshooting.
            </p>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">Debug Mode:</span> When enabled (
              <code>DEBUG=true</code>), the service provides additional logging for development and
              debugging purposes.
            </p>
          </div>

          {/* Configuration Parameters */}
          <div>
            <h5 className="text-md font-semibold text-gray-700">⚙️ Configuration Parameters</h5>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">Environment Variables:</span>
            </p>
            <ul className="list-disc list-inside ml-4 text-gray-600">
              <li>
                <code>BASE_PATH</code>: Base directory for media files (default:{' '}
                <code>/var/www/html</code>).
              </li>
              <li>
                <code>PREFIX_PATH</code>: URL path prefix for reverse proxies (default: empty).
              </li>
              <li>
                <code>DEBUG</code>: Enables debug mode (<code>true</code> or <code>false</code>).
              </li>
              <li>
                <code>TMDB_API_KEY</code>: API key for accessing TMDB services.
              </li>
              <li>
                <code>FRONT_END</code>: URL of the front-end application for synchronization.
              </li>
              <li>
                <code>WEBHOOK_ID</code>: Identifier for webhook authentication.
              </li>
            </ul>
          </div>

          {/* Usage Tips */}
          <div>
            <h5 className="text-md font-semibold text-gray-700">📚 Usage Tips</h5>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">Endpoint Testing:</span> Use tools like{' '}
              <a
                href="https://www.postman.com/"
                className="text-indigo-600 hover:text-indigo-800 underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                Postman
              </a>{' '}
              or{' '}
              <a
                href="https://curl.se/"
                className="text-indigo-600 hover:text-indigo-800 underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                cURL
              </a>{' '}
              to test endpoints and ensure they return the expected responses.
            </p>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">Error Handling:</span> Pay attention to HTTP status
              codes returned by the endpoints to handle errors gracefully in your application.
            </p>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">Performance Optimization:</span> Leverage caching
              effectively to minimize redundant processing and enhance response times.
            </p>
            <p className="mt-1 text-gray-600">
              <span className="font-semibold">Security Best Practices:</span> Regularly update your
              NodeJS dependencies and monitor for any security vulnerabilities.
            </p>
          </div>

          {/* Example Workflow */}
          <div>
            <h5 className="text-md font-semibold text-gray-700">🔗 Example Workflow</h5>
            <ol className="list-decimal list-inside ml-4 space-y-2 text-gray-600">
              <li>
                <span className="font-semibold">Adding a New Movie:</span>
                <ul className="list-disc list-inside ml-4">
                  <li>
                    Place the movie files in the designated <code>movies</code> directory.
                  </li>
                  <li>
                    Trigger the <code>/media/scan</code> endpoint to update the media library.
                  </li>
                  <li>
                    Use <code>/video/movie/:movieName</code> to stream the movie.
                  </li>
                  <li>
                    Access frames, sprite sheets, and chapters using the respective endpoints.
                  </li>
                </ul>
              </li>
              <li>
                <span className="font-semibold">Managing TV Shows:</span>
                <ul className="list-disc list-inside ml-4">
                  <li>
                    Organize TV show files in the <code>tv</code> directory, structured by show
                    name, season, and episode.
                  </li>
                  <li>
                    Utilize <code>/media/scan</code> to synchronize the library.
                  </li>
                  <li>Retrieve specific episodes or frames via the provided endpoints.</li>
                </ul>
              </li>
            </ol>
          </div>
        </div>
      </div>

      {/* Support & Maintenance Section */}
      <div>
        <h4 className="text-lg font-medium text-gray-700">🔧 Support & Maintenance</h4>
        <p className="mt-1 text-gray-600">
          For any issues or further assistance with the NodeJS service, refer to the application's
          logs located at <code>/var/log/cron.log</code> or consult the development team responsible
          for maintaining the service.
        </p>
      </div>
    </div>
  )
}

export default NodeJSDocumentation
