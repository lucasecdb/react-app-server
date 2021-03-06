import React from 'react'
import { StaticRouter } from 'react-router-dom/server'

import type { RootContext } from './RootContext'
import { RootContextProvider } from './RootContext'
import { RoutePendingContextProvider } from './RoutePendingContext'

export const RootServer: React.FC<{ context: unknown; url: string }> = ({
  context,
  url,
  children,
}) => {
  return (
    <RootContextProvider value={context as RootContext}>
      <RoutePendingContextProvider value={false}>
        <StaticRouter location={url}>{children}</StaticRouter>
      </RoutePendingContextProvider>
    </RootContextProvider>
  )
}
