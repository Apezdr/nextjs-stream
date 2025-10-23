'use client'

import { forwardRef } from 'react'
import { classNames } from '@src/utils'

/**
 * Material Design inspired button component
 * @param {Object} props
 * @param {React.ReactNode} props.children - Button content
 * @param {string} [props.className] - Additional CSS classes
 * @param {'filled'|'outlined'|'text'|'elevated'} [props.variant='filled'] - Button variant
 * @param {'primary'|'secondary'|'success'|'warning'|'error'|'neutral'} [props.color='primary'] - Button color
 * @param {'small'|'medium'|'large'} [props.size='medium'] - Button size
 * @param {boolean} [props.disabled=false] - Whether button is disabled
 * @param {boolean} [props.loading=false] - Whether button is in loading state
 * @param {React.ReactNode} [props.startIcon] - Icon to display at start
 * @param {React.ReactNode} [props.endIcon] - Icon to display at end
 * @param {Function} [props.onClick] - Click handler
 */
const MaterialButton = forwardRef(function MaterialButton({
  children,
  className = '',
  variant = 'filled',
  color = 'primary',
  size = 'medium',
  disabled = false,
  loading = false,
  startIcon,
  endIcon,
  onClick,
  ...props
}, ref) {
  const baseClasses = 'inline-flex items-center justify-center font-medium transition-all duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed'

  const sizeClasses = {
    small: 'px-3 py-1.5 text-sm rounded-lg',
    medium: 'px-4 py-2 text-sm rounded-lg',
    large: 'px-6 py-3 text-base rounded-xl'
  }

  const colorVariants = {
    filled: {
      primary: 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500 shadow-sm hover:shadow-md',
      secondary: 'bg-teal-600 text-white hover:bg-teal-700 focus:ring-teal-500 shadow-sm hover:shadow-md',
      success: 'bg-green-600 text-white hover:bg-green-700 focus:ring-green-500 shadow-sm hover:shadow-md',
      warning: 'bg-orange-600 text-white hover:bg-orange-700 focus:ring-orange-500 shadow-sm hover:shadow-md',
      error: 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500 shadow-sm hover:shadow-md',
      neutral: 'bg-gray-600 text-white hover:bg-gray-700 focus:ring-gray-500 shadow-sm hover:shadow-md'
    },
    outlined: {
      primary: 'border-2 border-blue-600 text-blue-600 hover:bg-blue-50 focus:ring-blue-500',
      secondary: 'border-2 border-teal-600 text-teal-600 hover:bg-teal-50 focus:ring-teal-500',
      success: 'border-2 border-green-600 text-green-600 hover:bg-green-50 focus:ring-green-500',
      warning: 'border-2 border-orange-600 text-orange-600 hover:bg-orange-50 focus:ring-orange-500',
      error: 'border-2 border-red-600 text-red-600 hover:bg-red-50 focus:ring-red-500',
      neutral: 'border-2 border-gray-600 text-gray-600 hover:bg-gray-50 focus:ring-gray-500'
    },
    text: {
      primary: 'text-blue-600 hover:bg-blue-50 focus:ring-blue-500',
      secondary: 'text-teal-600 hover:bg-teal-50 focus:ring-teal-500',
      success: 'text-green-600 hover:bg-green-50 focus:ring-green-500',
      warning: 'text-orange-600 hover:bg-orange-50 focus:ring-orange-500',
      error: 'text-red-600 hover:bg-red-50 focus:ring-red-500',
      neutral: 'text-gray-600 hover:bg-gray-50 focus:ring-gray-500'
    },
    elevated: {
      primary: 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500 shadow-md hover:shadow-lg',
      secondary: 'bg-teal-600 text-white hover:bg-teal-700 focus:ring-teal-500 shadow-md hover:shadow-lg',
      success: 'bg-green-600 text-white hover:bg-green-700 focus:ring-green-500 shadow-md hover:shadow-lg',
      warning: 'bg-orange-600 text-white hover:bg-orange-700 focus:ring-orange-500 shadow-md hover:shadow-lg',
      error: 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500 shadow-md hover:shadow-lg',
      neutral: 'bg-gray-600 text-white hover:bg-gray-700 focus:ring-gray-500 shadow-md hover:shadow-lg'
    }
  }

  const iconSizeClasses = {
    small: 'w-4 h-4',
    medium: 'w-5 h-5',
    large: 'w-6 h-6'
  }

  const buttonClasses = classNames(
    baseClasses,
    sizeClasses[size],
    colorVariants[variant][color],
    className
  )

  const iconSize = iconSizeClasses[size]

  return (
    <button
      ref={ref}
      className={buttonClasses}
      disabled={disabled || loading}
      onClick={onClick}
      {...props}
    >
      {loading ? (
        <>
          <svg
            className={classNames('animate-spin -ml-1 mr-3', iconSize)}
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          Loading...
        </>
      ) : (
        <>
          {startIcon && (
            <span className={classNames('mr-2', iconSize)}>
              {startIcon}
            </span>
          )}
          {children}
          {endIcon && (
            <span className={classNames('ml-2', iconSize)}>
              {endIcon}
            </span>
          )}
        </>
      )}
    </button>
  )
})

export default MaterialButton