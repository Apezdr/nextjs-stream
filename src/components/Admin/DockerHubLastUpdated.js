'use client';
import Loading from "@src/app/loading";
import { buildURL } from "@src/utils";
import { useState, useEffect } from "react";

export default function DockerHubLastUpdated() {
  const [dockerData, setDockerData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchLastUpdated = async () => {
      try {
        const response = await fetch(buildURL("/api/authenticated/admin/dockerhub-lastupdated"));
        if (!response.ok) {
          throw new Error("Failed to fetch last updated information.");
        }
        const data = await response.json();
        setDockerData(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchLastUpdated();
  }, []);

  if (loading) {
    return <div className="text-center text-gray-200"><Loading fullscreenClasses={false} /></div>;
  }

  if (error) {
    return <div className="text-red-500 text-center">Error: {error}</div>;
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4 text-center">Docker Images</h1>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {dockerData.map(({ repo, isUpToDate, last_updated, serverDigest  }) => (
          <li key={repo} className="flex items-center justify-between p-4 rounded-lg shadow-lg bg-gradient-to-r from-blue-100 to-blue-200">
            <div className="w-full">
                {
                    // If it has a server digest,
                    // it has the ability to know if it's up to date
                    serverDigest ? (
                    <span
                        className={`block px-3 py-1 rounded-md text-xs font-medium ${
                        isUpToDate ? "bg-green-500 text-white" : "bg-yellow-500 text-gray-800"
                        }`}
                    >
                        {isUpToDate ? "✓ Updated" : "⚠ Needs Update"}
                    </span>
                    ) : null
                }
              <strong className="text-lg text-gray-800">{repo}</strong>
              <p className="text-gray-600 text-sm">
                {isUpToDate ? (
                  <span className="text-green-600 font-medium block">Up to date</span>
                ) : null}
                <span className="text-gray-700">
                    Last updated: <span className="font-medium">{new Date(last_updated).toLocaleString()}</span>
                  </span>
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
