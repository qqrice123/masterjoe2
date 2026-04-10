import { Route, Switch } from "wouter";
import { Dashboard } from "./features/AnalyticsDashboard/Dashboard";
import { RaceView } from "./features/RaceSetup/RaceView";
import { Header } from "./layout/Header";

export function App() {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans pb-16 sm:pb-0">
      <Header />
      <main className="max-w-7xl mx-auto p-4 pt-6">
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/race/:venue/:raceNo" component={RaceView} />
          <Route>
            <div className="text-center py-20 text-gray-500">
              <h2 className="text-2xl font-bold text-gray-700">404</h2>
              <p>頁面不存在</p>
            </div>
          </Route>
        </Switch>
      </main>
    </div>
  );
}