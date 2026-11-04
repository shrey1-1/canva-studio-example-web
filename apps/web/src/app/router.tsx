import { createBrowserRouter } from 'react-router';
import { HomeRoute } from '../routes/HomeRoute';
import { EditorRoute } from '../routes/EditorRoute';
import { PresentRoute } from '../routes/PresentRoute';
import { RouteError } from './ErrorBoundary';

export const router = createBrowserRouter([
  { path: '/', element: <HomeRoute />, errorElement: <RouteError /> },
  { path: '/file/:docId', element: <EditorRoute />, errorElement: <RouteError /> },
  { path: '/file/:docId/present', element: <PresentRoute />, errorElement: <RouteError /> },
  { path: '*', element: <RouteError notFound /> },
]);
