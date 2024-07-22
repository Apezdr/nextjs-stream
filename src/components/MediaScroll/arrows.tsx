'use client'

import React from 'react'
import { VisibilityContext } from 'react-horizontal-scrolling-menu'

function Arrow({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode
  disabled: boolean
  onClick: VoidFunction
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="transition-opacity duration-200"
      style={{
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        right: '1%',
        opacity: disabled ? '0' : '1',
        userSelect: 'none',
      }}
    >
      {children}
    </button>
  )
}

export function LeftArrow() {
  const { isFirstItemVisible, scrollPrev, visibleElements, initComplete } =
    React.useContext(VisibilityContext)

  const [disabled, setDisabled] = React.useState(
    !initComplete || (initComplete && isFirstItemVisible)
  )
  React.useEffect(() => {
    // NOTE: detect if whole component visible
    if (visibleElements.length) {
      setDisabled(isFirstItemVisible)
    }
  }, [isFirstItemVisible, visibleElements])

  return (
    <Arrow disabled={disabled} onClick={() => scrollPrev()}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        xmlSpace="preserve"
        viewBox="0 0 330 330"
        className="w-8 h-8"
      >
        <path
          fill="#fff"
          d="M111.213 165.004 250.607 25.607c5.858-5.858 5.858-15.355 0-21.213-5.858-5.858-15.355-5.858-21.213.001l-150 150.004a15 15 0 0 0 0 21.212l150 149.996C232.322 328.536 236.161 330 240 330s7.678-1.464 10.607-4.394c5.858-5.858 5.858-15.355 0-21.213L111.213 165.004z"
        />
      </svg>
    </Arrow>
  )
}

export function RightArrow() {
  const { isLastItemVisible, scrollNext, visibleElements } = React.useContext(VisibilityContext)

  // console.log({ isLastItemVisible });
  const [disabled, setDisabled] = React.useState(!visibleElements.length && isLastItemVisible)
  React.useEffect(() => {
    if (visibleElements.length) {
      setDisabled(isLastItemVisible)
    }
  }, [isLastItemVisible, visibleElements])

  return (
    <Arrow disabled={disabled} onClick={() => scrollNext()}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        xmlSpace="preserve"
        fill="#fff"
        viewBox="0 0 330.002 330.002"
        className="w-8 h-8"
      >
        <path d="M233.252 155.997 120.752 6.001c-4.972-6.628-14.372-7.97-21-3-6.628 4.971-7.971 14.373-3 21l105.75 140.997-105.75 141.003c-4.971 6.627-3.627 16.03 3 21a14.93 14.93 0 0 0 8.988 3.001c4.561 0 9.065-2.072 12.012-6.001l112.5-150.004a15 15 0 0 0 0-18z" />
      </svg>
    </Arrow>
  )
}
