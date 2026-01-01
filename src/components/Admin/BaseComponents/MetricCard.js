import MaterialCard, { MaterialCardContent } from './MaterialCard'
import StatusBadge from './StatusBadge'
import { classNames } from '@src/utils'

/**
 * Material Design inspired metric card component for displaying key statistics
 * @param {Object} props
 * @param {string} props.title - Metric title
 * @param {string|number} props.value - Metric value
 * @param {string} [props.subtitle] - Optional subtitle or description
 * @param {React.ReactNode} [props.icon] - Optional icon
 * @param {string} [props.trend] - Trend indicator ('up'|'down'|'neutral')
 * @param {string} [props.trendValue] - Trend value (e.g., '+5%')
 * @param {'success'|'warning'|'error'|'info'|'neutral'} [props.status] - Status for color coding
 * @param {string} [props.className] - Additional CSS classes
 * @param {Function} [props.onClick] - Click handler for interactive cards
 */
const MetricCard = ({
  title,
  value,
  subtitle,
  icon,
  trend,
  trendValue,
  status = 'neutral',
  className = '',
  onClick,
  ...props
}) => {
  const trendIcons = {
    up: (
      <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 17l9.2-9.2M17 17V7m0 10H7" />
      </svg>
    ),
    down: (
      <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 7l-9.2 9.2M7 7v10m0-10h10" />
      </svg>
    ),
    neutral: (
      <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
      </svg>
    )
  }

  const statusColors = {
    success: 'text-green-600',
    warning: 'text-orange-600',
    error: 'text-red-600',
    info: 'text-blue-600',
    neutral: 'text-gray-600'
  }

  return (
    <MaterialCard
      className={classNames('h-full', className)}
      interactive={!!onClick}
      onClick={onClick}
      elevation="low"
      {...props}
    >
      <MaterialCardContent>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center space-x-2 mb-2">
              {icon && (
                <div className={classNames('flex-shrink-0', statusColors[status])}>
                  {icon}
                </div>
              )}
              <h3 className="text-sm font-medium text-gray-600 truncate">
                {title}
              </h3>
            </div>
            
            <div className="flex items-baseline space-x-2">
              <p className={classNames(
                'text-2xl font-bold tracking-tight',
                statusColors[status]
              )}>
                {value}
              </p>
              
              {trend && trendValue && (
                <div className="flex items-center space-x-1">
                  {trendIcons[trend]}
                  <span className={classNames(
                    'text-sm font-medium',
                    trend === 'up' ? 'text-green-600' : 
                    trend === 'down' ? 'text-red-600' : 'text-gray-600'
                  )}>
                    {trendValue}
                  </span>
                </div>
              )}
            </div>
            
            {subtitle && (
              <p className="text-sm text-gray-500 mt-2">
                {subtitle}
              </p>
            )}
          </div>
          
          {status !== 'neutral' && (
            <div className="flex-shrink-0 ml-4">
              <StatusBadge 
                status={status} 
                size="small"
                variant="soft"
              >
                {status}
              </StatusBadge>
            </div>
          )}
        </div>
      </MaterialCardContent>
    </MaterialCard>
  )
}

export default MetricCard