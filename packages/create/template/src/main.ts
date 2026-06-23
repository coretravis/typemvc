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
  logging: { level: 'debug' },
  configure(app) {
    // Register routed controllers. Add services here too, e.g.
    //   app.singleton(MY_SERVICE, () => new MyService());
    app.route(HomeController);
    app.route(NotFoundController); // @controller('*') catch-all, keep this last.
  },
});
