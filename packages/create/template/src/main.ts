// Tokens load before any component stylesheet, so a component that consumes a
// token has it defined. The application owns this cascade order; the framework
// injects nothing into it.
import './styles/tokens.css';
import { bootstrap } from '@typemvc/core';
import { HomeController } from './controllers/HomeController.js';
import { NotFoundController } from './controllers/NotFoundController.js';

const outlet = document.getElementById('app');
if (outlet === null) throw new Error('[App] No #app element found in index.html');

bootstrap({
  outlet,
  viewsRoot: '/src/views/',
  // Lazy view glob: each .tmvc view is code-split and loaded on navigation.
  views: import.meta.glob('/src/views/**/*.tmvc'),
  // Components are eager so a tag resolves the instant a view names it. A sibling
  // Name.tmvc.css is imported with the component and code split alongside it.
  components: import.meta.glob('/src/components/**/*.tmvc', { eager: true }),
  logging: { level: 'debug' },
  configure(app) {
    // Register routed controllers. Add services here too, e.g.
    //   app.singleton(MY_SERVICE, () => new MyService());
    app.route(HomeController);
    app.route(NotFoundController); // @controller('*') catch-all, keep this last.
  },
});
