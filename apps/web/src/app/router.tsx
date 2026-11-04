import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter } from 'react-router';
import { AuthGate } from './AuthGate';
import { RouteError } from './ErrorBoundary';

// Each screen loads on demand: the sign-in screen does not pay for the editor, Konva or the tools.
const HomeRoute = lazy(() => import('../routes/HomeRoute').then((m) => ({ default: m.HomeRoute })));
const EditorRoute = lazy(() => import('../routes/EditorRoute').then((m) => ({ default: m.EditorRoute })));
const PresentRoute = lazy(() => import('../routes/PresentRoute').then((m) => ({ default: m.PresentRoute })));

const loading = (screen: ReactNode) => (
  <Suspense fallback={<div role="status" className="flex h-full items-center justify-center text-fg-muted">Loading…</div>}>{screen}</Suspense>
);

export const router = createBrowserRouter([
  {
    element: <AuthGate />,
    errorElement: <RouteError />,
    children: [
      { path: '/', element: loading(<HomeRoute />) },
      { path: '/file/:docId', element: loading(<EditorRoute />) },
      { path: '/file/:docId/present', element: loading(<PresentRoute />) },
      { path: '*', element: <RouteError notFound /> },
    ],
  },
]);
