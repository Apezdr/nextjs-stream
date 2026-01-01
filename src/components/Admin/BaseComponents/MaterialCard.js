'use client'

import { forwardRef } from 'react'
import { classNames } from '@src/utils'

/**
 * Material Design inspired card component with consistent elevation and styling
 * @param {Object} props
 * @param {React.ReactNode} props.children - Card content
 * @param {string} [props.className] - Additional CSS classes
 * @param {'flat'|'low'|'medium'|'high'} [props.elevation='low'] - Card elevation level
 * @param {boolean} [props.interactive=false] - Whether card has hover effects
 * @param {Function} [props.onClick] - Click handler for interactive cards
 * @param {string} [props.variant='default'] - Card variant (default, outlined, filled)
 */
const MaterialCard = forwardRef(function MaterialCard({
  children,
  className = '',
  elevation = 'low',
  interactive = false,
  onClick,
  variant = 'default',
  ...props
}, ref) {
  const elevationClasses = {
    flat: '',
    low: 'shadow-sm hover:shadow-md',
    medium: 'shadow-md hover:shadow-lg',
    high: 'shadow-lg hover:shadow-xl'
  }

  const variantClasses = {
    default: 'bg-white border border-gray-200',
    outlined: 'bg-white border-2 border-gray-300',
    filled: 'bg-gray-50 border border-gray-200',
    surface: 'bg-white shadow-sm border border-gray-100'
  }

  const baseClasses = classNames(
    // Base styling
    'rounded-xl transition-all duration-200 ease-in-out',
    // Elevation
    elevationClasses[elevation],
    // Variant
    variantClasses[variant],
    // Interactive behavior
    interactive && 'cursor-pointer transform hover:scale-[1.02] hover:-translate-y-0.5',
    // Additional classes
    className
  )

  return (
    <div
      ref={ref}
      className={baseClasses}
      onClick={onClick}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      {...props}
    >
      {children}
    </div>
  )
})

/**
 * Material Card Header component
 */
export const MaterialCardHeader = ({ 
  title, 
  subtitle, 
  icon, 
  action, 
  className = '' 
}) => (
  <div className={classNames('px-6 py-4 border-b border-gray-200', className)}>
    <div className="flex items-center justify-between">
      <div className="flex items-center space-x-3">
        {icon && (
          <div className="flex-shrink-0 text-blue-600">
            {icon}
          </div>
        )}
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            {title}
          </h3>
          {subtitle && (
            <p className="text-sm text-gray-600 mt-1">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {action && (
        <div className="flex-shrink-0">
          {action}
        </div>
      )}
    </div>
  </div>
)

/**
 * Material Card Content component
 */
export const MaterialCardContent = ({ 
  children, 
  className = '',
  padding = 'normal' 
}) => {
  const paddingClasses = {
    none: '',
    compact: 'p-4',
    normal: 'p-6',
    large: 'p-8'
  }

  return (
    <div className={classNames(paddingClasses[padding], className)}>
      {children}
    </div>
  )
}

/**
 * Material Card Actions component
 */
export const MaterialCardActions = ({ 
  children, 
  className = '',
  align = 'right' 
}) => {
  const alignClasses = {
    left: 'justify-start',
    center: 'justify-center',
    right: 'justify-end',
    between: 'justify-between'
  }

  return (
    <div className={classNames(
      'px-6 py-4 border-t border-gray-200 flex items-center space-x-3',
      alignClasses[align],
      className
    )}>
      {children}
    </div>
  )
}

export default MaterialCard