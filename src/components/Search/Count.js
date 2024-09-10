'use client'
import { memo } from 'react'
import CountUp from 'react-countup'

const Count = memo(({ data }) => (
  <CountUp start={0} end={data} preserveValue={true} duration={1.5} separator="," />
))

Count.displayName = 'Count'

export default Count
