import { Controller, controller, get, action, retain, signal, computed, View } from '@typemvc/core';
import type { IView, ReadonlySignal } from '@typemvc/core';

type HomeData = {
  title: string;
  count: ReadonlySignal<number>;
  doubled: ReadonlySignal<number>;
};

// '/' is the home route. @retain() keeps this instance, and its signal state,
// alive across navigations, so the count survives leaving and returning.
@controller('/')
@retain()
class HomeController extends Controller {
  readonly #count = signal(0);
  readonly #doubled = computed(() => this.#count.get() * 2);

  // GET '/' renders views/home/index.tmvc (convention: <controller>/<action>).
  @get()
  index(): IView<HomeData> {
    return View({
      title: 'Hello, TypeMVC',
      count: this.#count,
      doubled: this.#doubled,
    });
  }

  // @action marks a non-route method exposed to the view as context.increment.
  // Mutating the signal reactively updates only the DOM nodes that read it.
  @action
  increment(): void {
    this.#count.update((n) => n + 1);
  }

  @action
  reset(): void {
    this.#count.set(0);
  }
}

export { HomeController };
