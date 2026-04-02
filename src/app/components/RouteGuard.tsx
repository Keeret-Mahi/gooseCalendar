import React, { useEffect } from "react";
import { useNavigate } from "react-router";
import { useAppContext } from "./AppContext";

interface RouteGuardProps {
  children: React.ReactNode;
}

export function RouteGuard({ children }: RouteGuardProps) {
  const { uploads } = useAppContext();
  const navigate = useNavigate();

  useEffect(() => {
    if (uploads.length === 0) {
      navigate("/", { replace: true });
    }
  }, [uploads.length, navigate]);

  if (uploads.length === 0) return null;

  return <>{children}</>;
}
