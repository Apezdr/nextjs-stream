/**
 * Common wrapper component for all dashboard cards
 * @param {Object} props
 * @param {string} props.title - Card title
 * @param {React.ReactNode} props.icon - Icon to display next to title
 * @param {React.ReactNode} props.children - Card content
 * @param {number} [props.count] - Optional count badge
 * @param {string} [props.status] - Optional status text
 * @param {Function} [props.onRefresh] - Optional refresh callback
 */
const DashboardCard = ({ title, icon, children, count, status, onRefresh }) => {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md overflow-hidden border border-gray-200 dark:border-slate-700 flex flex-col h-full">
      <div className="bg-gradient-to-r from-indigo-600 to-blue-500 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center">
          {icon && <span className="mr-2 text-white">{icon}</span>}
          <h2 className="text-lg font-semibold text-white flex items-center">
            {title}
            {count > 0 && (
              <span className="ml-2 bg-white text-indigo-600 text-xs font-bold rounded-full px-2 py-0.5">
                {count}
              </span>
            )}
          </h2>
        </div>
        <div className="flex items-center">
          {typeof(status) === "string" ? (
            <span className={`px-2 py-1 rounded-full text-xs font-medium mr-2 ${
              status?.toLowerCase() === 'paused' 
                ? 'bg-yellow-100 text-yellow-800' 
                : 'bg-green-100 text-green-800'
            }`}>
              {status}
            </span>
          ) : (
            <span className={`px-2 py-1 rounded-full text-xs font-medium mr-2`}>
              {status}
            </span>
          )}
          {onRefresh && (
            <button 
              onClick={onRefresh} 
              className="text-white hover:text-blue-100 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
              </svg>
            </button>
          )}
        </div>
      </div>
      <div className="p-4 flex-grow">{children}</div>
    </div>
  );
};

export default DashboardCard;