import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { ThemeProvider } from "@/hooks/useTheme";
import { AppLayout } from "@/components/layout/AppLayout";
import { AuthPage } from "@/pages/Auth";
import { HomePage } from "@/pages/Home";
import { DailyRoutinePage } from "@/pages/DailyRoutine";
import { TodosPage } from "@/pages/Todos";
import { GymPage } from "@/pages/Gym";
import { MotivationPage } from "@/pages/Motivation";
import { CodingTrackerPage } from "@/pages/CodingTracker";
import { HealthPeriodPage } from "@/pages/HealthPeriod";
import { HealthDiabetesPage } from "@/pages/HealthDiabetes";
import { FinanceTransactionsPage } from "@/pages/FinanceTransactions";
import { FinanceStatsPage } from "@/pages/FinanceStats";
import { FinanceAccountsPage } from "@/pages/FinanceAccounts";
import { FinanceCategoriesPage } from "@/pages/FinanceCategories";
import { SettingsProfilePage } from "@/pages/SettingsProfile";
import { SettingsAppearancePage } from "@/pages/SettingsAppearance";
import { SettingsIntegrationsPage } from "@/pages/SettingsIntegrations";

function ProtectedRoutes() {
  const { session, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }
  if (!session) return <Navigate to="/auth" replace />;
  return <AppLayout />;
}

function PublicOnly({ children }: { children: JSX.Element }) {
  const { session, loading } = useAuth();
  if (loading) return null;
  if (session) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/auth" element={<PublicOnly><AuthPage /></PublicOnly>} />
            <Route element={<ProtectedRoutes />}>
              <Route path="/" element={<MotivationPage />} />
              <Route path="/dashboard" element={<HomePage />} />
              <Route path="/daily-routine" element={<DailyRoutinePage />} />
              <Route path="/todos" element={<TodosPage />} />
              <Route path="/gym" element={<GymPage />} />
              <Route path="/coding-tracker" element={<CodingTrackerPage />} />
              <Route path="/motivation" element={<Navigate to="/" replace />} />
              <Route path="/health/period" element={<HealthPeriodPage />} />
              <Route path="/health/diabetes" element={<HealthDiabetesPage />} />
              <Route path="/finance/transactions" element={<FinanceTransactionsPage />} />
              <Route path="/finance/stats" element={<FinanceStatsPage />} />
              <Route path="/finance/accounts" element={<FinanceAccountsPage />} />
              <Route path="/finance/categories" element={<FinanceCategoriesPage />} />
              <Route path="/finance" element={<Navigate to="/finance/transactions" replace />} />
              <Route path="/settings/profile" element={<SettingsProfilePage />} />
              <Route path="/settings/appearance" element={<SettingsAppearancePage />} />
              <Route path="/settings/integrations" element={<SettingsIntegrationsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
