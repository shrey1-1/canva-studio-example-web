import { createBrowserRouter } from 'react-router';
import { HomeRoute } from '../routes/HomeRoute';
import { EditorRoute } from '../routes/EditorRoute';
import { PresentRoute } from '../routes/PresentRoute';
import { AuthGate } from './AuthGate';
import { RouteError } from './ErrorBoundary';

export const router = createBrowserRouter([
  {
    element: <AuthGate />,
    errorElement: <RouteError />,
    children: [
      { path: '/', element: <HomeRoute /> },
      { path: '/file/:docId', element: <EditorRoute /> },
      { path: '/file/:docId/present', element: <PresentRoute /> },
      { path: '*', element: <RouteError notFound /> },
    ],
  },
]);
