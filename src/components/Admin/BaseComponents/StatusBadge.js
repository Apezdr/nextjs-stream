import { classNames } from '@src/utils'

/**
 * Material Design inspired status badge component
 * @param {Object} props
 * @param {React.ReactNode} props.children - Badge content
 * @param {string} [props.className] - Additional CSS classes
 * @param {'success'|'warning'|'error'|'info'|'neutral'} [props.status='neutral'] - Status type
 * @param {'small'|'medium'|'large'} [props.size='medium'] - Badge size
 * @param {'filled'|'outlined'|'soft'} [props.variant='filled'] - Badge variant
 * @param {React.ReactNode} [props.icon] - Optional icon
 * @param {boolean} [props.pulse=false] - Whether to show pulse animation
 */
const StatusBadge = ({
  children,
  className = '',
  status = 'neutral',
  size = 'medium',
  variant = 'filled',
  icon,
  pulse = false,
  ...props
}) => {
  const sizeClasses = {
    small: 'px-2 py-0.5 text-xs',
    medium: 'px-2.5 py-1 text-sm',
    large: 'px-3 py-1.5 text-base'
  }

  const statusVariants = {
    filled: {
      success: 'bg-green-100 text-green-800 border-green-200',
      warning: 'bg-orange-100 text-orange-800 border-orange-200',
      error: 'bg-red-100 text-red-800 border-red-200',
      info: 'bg-blue-100 text-blue-800 border-blue-200',
      neutral: 'bg-gray-100 text-gray-800 border-gray-200'
    },
    outlined: {
      success: 'bg-white text-green-700 border-2 border-green-300',
      warning: 'bg-white text-orange-700 border-2 border-orange-300',
      error: 'bg-white text-red-700 border-2 border-red-300',
      info: 'bg-white text-blue-700 border-2 border-blue-300',
      neutral: 'bg-white text-gray-700 border-2 border-gray-300'
    },
    soft: {
      success: 'bg-green-50 text-green-700 border-green-100',
      warning: 'bg-orange-50 text-orange-700 border-orange-100',
      error: 'bg-red-50 text-red-700 border-red-100',
      info: 'bg-blue-50 text-blue-700 border-blue-100',
      neutral: 'bg-gray-50 text-gray-700 border-gray-100'
    }
  }

  const iconSizeClasses = {
    small: 'w-3 h-3',
    medium: 'w-4 h-4',
    large: 'w-5 h-5'
  }

  const badgeClasses = classNames(
    'inline-flex items-center font-medium rounded-full border transition-all duration-200',
    sizeClasses[size],
    statusVariants[variant][status],
    className
  )

  const iconSize = iconSizeClasses[size]

  return (
    <span className={badgeClasses} {...props}>
      {icon && (
        <span className={classNames('mr-1.5', iconSize, pulse && 'relative')}>
          {pulse && (
            <span className="absolute inset-0 animate-ping rounded-full bg-current opacity-75" />
          )}
          <span className="relative">{icon}</span>
        </span>
      )}
      {pulse && !icon && (
        <span className="mr-1.5 relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
        </span>
      )}
      {children}
    </span>
  )
}

export default StatusBadge