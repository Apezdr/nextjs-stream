'use client';
import Loading from "@src/app/loading";
import { buildURL } from "@src/utils";
import useSWR from "swr";

const fetchLastUpdated = async () => {
  const response = await fetch(buildURL("/api/authenticated/admin/dockerhub-lastupdated"));
  if (!response.ok) {
    throw new Error("Failed to fetch last updated information.");
  }
  return response.json();
};

export default function DockerHubLastUpdated() {
  const { data: dockerData, error, isLoading } = useSWR(
    "/api/authenticated/admin/dockerhub-lastupdated",
    fetchLastUpdated,
    { revalidateOnFocus: false }
  );

  if (isLoading) {
    return <div className="text-center text-gray-200"><Loading fullscreenClasses={false} /></div>;
  }

  if (error) {
    return <div className="text-red-500 text-center">Error: {error.message}</div>;
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4 text-center">Docker Images</h1>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Docker Hub's view only: the app has no Docker access, so it can't
            tell whether the running image is the latest one. */}
        {(dockerData || []).map(({ repo, last_updated }) => (
          <li key={repo} className="flex items-center justify-between p-4 rounded-lg shadow-lg bg-gradient-to-r from-blue-100 to-blue-200">
            <div className="w-full">
              <strong className="text-lg text-gray-800">{repo}</strong>
              <p className="text-gray-600 text-sm">
                {last_updated ? (
                  <span className="text-gray-700">
                    Last pushed to Docker Hub: <span className="font-medium">{new Date(last_updated).toLocaleString()}</span>
                  </span>
                ) : (
                  <span className="text-yellow-700">Couldn&apos;t reach Docker Hub.</span>
                )}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
