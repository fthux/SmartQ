import { createAppStore } from "../stores/app-store.js";
import { provideSmartQ } from "../stores/context.js";
import { ConsoleShell } from "./ConsoleShell.js";
import { GlobalOverlays } from "./GlobalOverlays.js";
import { LoginPage } from "../pages/LoginPage.js";

export const AppRoot = {
  name: "AppRoot",
  components: { ConsoleShell, GlobalOverlays, LoginPage },
  setup() {
    const context = createAppStore();
    provideSmartQ(context);
    return context;
  },
  template: `
    <main :class="state.admin.token ? 'min-h-screen w-full bg-[#f3f6f8]' : 'min-h-screen w-full overflow-hidden bg-[#f2f5fa]'">
      <LoginPage v-if="!state.admin.token" />
      <ConsoleShell v-else />
      <GlobalOverlays />
    </main>
  `,
};
