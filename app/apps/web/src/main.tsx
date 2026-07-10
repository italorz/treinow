import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import { AppShell } from "./shell";
import { AuthPage } from "./pages/Auth";
import { TodayPage } from "./pages/Today";
import { ExercisesPage } from "./pages/Exercises";
import { CalendarPage } from "./pages/Calendar";
import { MetaPage } from "./pages/Meta";
import { TrainerPage } from "./pages/Trainer";
import { InvitePage } from "./pages/Invite";
import "./styles.css";

const router = createBrowserRouter([
  { path: "/login", element: <AuthPage /> },
  { path: "/cadastro", element: <AuthPage register /> },
  { path: "/convite/:token", element: <InvitePage /> },
  { element: <AppShell />, children: [
    { index: true, element: <Navigate to="/hoje" replace /> },
    { path: "/hoje", element: <TodayPage /> },
    { path: "/exercicios", element: <ExercisesPage /> },
    { path: "/calendario", element: <CalendarPage /> },
    { path: "/meta", element: <MetaPage /> },
    { path: "/personal", element: <TrainerPage /> }
  ]}
]);
const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } });
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider></React.StrictMode>
);
