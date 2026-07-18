import { Controller, controller, get, View } from '@typemvc/core';
import type { IView } from '@typemvc/core';

// '*' is the catch-all: any URL no other controller matches lands here.
@controller('*')
class NotFoundController extends Controller {
  @get()
  notFound(): IView {
    return View('notfound/notfound');
  }
}

export { NotFoundController };
