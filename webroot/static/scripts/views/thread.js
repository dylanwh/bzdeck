/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Define the Thread View. This constructor is intended to be inherited by each specific thread view.
 * @extends BzDeck.BaseView
 */
BzDeck.ThreadView = class ThreadView extends BzDeck.BaseView {
  /**
   * Called whenever one or more items are selected on the thread. Show the last-selected bug in the relevant Preview
   * Pane or a new tab.
   * @argument {CustomEvent} event - Providing an array of seleted item IDs.
   * @return {undefined}
   */
  onselect (event) {
    let ids = event.detail.ids;

    if (ids.length) {
      this.consumer.controller.data.preview_id = Number.parseInt(ids[ids.length - 1]);
    }
  }

  /**
   * Called whenever the thread is double-clicked. Show the selected bug in a new tab.
   * @argument {MouseEvent} event - Fired dblclick event.
   * @argument {String} selector - Defining the target element.
   * @return {undefined}
   */
  ondblclick (event, selector) {
    let $target = event.originalTarget;

    if ($target.matches(selector)) {
      this.open_bug(Number($target.dataset.id));
    }
  }

  /**
   * Open a specific bug in a new tab.
   * @argument {Number} id - Bug ID to show.
   * @return {undefined}
   */
  open_bug (id) {
    this.trigger('GlobalView:OpenBug', { id, ids: [...this.consumer.controller.data.bugs.keys()] });
  }
}

/**
 * Define the Classic Thread View that represents a traditional tabular thread.
 * @extends BzDeck.ThreadView
 */
BzDeck.ClassicThreadView = class ClassicThreadView extends BzDeck.ThreadView {
  /**
   * Get a ClassicThreadView instance.
   * @constructor
   * @argument {Object} consumer - View that contains the thread.
   * @argument {String} name - Identifier for the thread.
   * @argument {HTMLElement} $grid - Element to be activated as the new thread. Should have the grid role.
   * @argument {Array} columns - Column list.
   * @argument {Object} options - Used for the Grid widget.
   * @return {Object} view - New ClassicThreadView instance.
   */
  constructor (consumer, name, $grid, columns, options) {
    super(); // This does nothing but is required before using `this`

    let default_cols = BzDeck.config.grid.default_columns,
        field = BzDeck.host.data.config.field;

    let toggle_prop = prop => {
      for (let $item of this.$$grid.view.selected) {
        let _data = this.$$grid.data.rows[$item.sectionRowIndex].data;

        _data[prop] = _data[prop] !== true;
      }
    };

    this.consumer = consumer;
    this.bugs = [];

    this.$$grid = new this.widgets.Grid($grid, {
      rows: [],
      columns: (columns || default_cols).map(col => {
        col.label = (default_cols.find(__col => __col.id === col.id) || {}).label || field[col.id].description;

        return col;
      })
    }, options);

    this.$$grid.bind('Selected', event => this.onselect(event));
    this.$$grid.bind('dblclick', event => this.ondblclick(event, '[role="row"]'));
    this.$$grid.bind('Sorted', event => BzDeck.prefs.set(`${name}.list.sort_conditions`, event.detail.conditions));

    this.$$grid.bind('ColumnModified', event => {
      BzDeck.prefs.set(`${name}.list.columns`, event.detail.columns.map(col => ({
        id: col.id,
        type: col.type || 'string',
        hidden: col.hidden || false
      })));
    });

    this.$$grid.assign_key_bindings({
      // Show previous bug, an alias of UP
      B: event => this.helpers.kbd.dispatch($grid, 'ArrowUp'),
      // Show next bug, an alias of DOWN
      F: event => this.helpers.kbd.dispatch($grid, 'ArrowDown'),
      // Toggle read
      M: event => toggle_prop('unread'),
      // Toggle star
      S: event => toggle_prop('starred'),
    });

    this.subscribe('BugModel:AnnotationUpdated', true);
  }

  /**
   * Update the thread with the specified bugs.
   * @argument {Map.<Number, Proxy>} bugs - List of bugs to render.
   * @return {undefined}
   */
  update (bugs) {
    this.bugs = bugs;

    Promise.all([...bugs.values()].map(bug => {
      let row = {
        id: `${this.$$grid.view.$container.id}-row-${bug.id}`,
        data: {},
        dataset: {
          unread: bug.unread === true,
          severity: bug.severity
        }
      };

      return Promise.all(this.$$grid.data.columns.map(column => {
        let field = column.id,
            value = bug[field];

        return new Promise(resolve => {
          if (!value) {
            resolve('');
          } else if (Array.isArray(value)) {
            if (field === 'mentors') { // Array of Person
              Promise.all(bug.mentors.map(name => BzDeck.collections.users.get(name, { name }))).then(mentors => {
                resolve(mentors.map(mentor => mentors.name).join(', '));
              });
            } else { // Keywords
              resolve(value.join(', '));
            }
          } else if (typeof value === 'object' && !Array.isArray(value)) { // Person
            BzDeck.collections.users.get(value.name, { name: value.name }).then(user => resolve(user.name));
          } else if (field === 'starred') {
            resolve(bug.starred);
          } else if (field === 'unread') {
            resolve(value === true);
          } else {
            resolve(value); // Simply return the value in String or Number
          }
        }).then(value => row.data[field] = value);
      })).then(() => {
        row.data = new Proxy(row.data, {
          set: (obj, prop, value) => {
            if (prop === 'starred') {
              bug.starred = value;
            }

            if (prop === 'unread') {
              bug.unread = value;

              let row = this.$$grid.data.rows.find(row => row.data.id === obj.id);

              if (row && row.$element) {
                row.$element.dataset.unread = value;
              }
            }

            obj[prop] = value;

            return true;
          }
        });
      }).then(() => row);
    })).then(rows => this.$$grid.build_body(rows));
  }

  /**
   * Filter the thread with the specified bugs.
   * @argument {Map.<Number, Proxy>} bugs - List of bugs to show.
   * @return {undefined}
   */
  filter (bugs) {
    this.$$grid.filter([...bugs.keys()]);
  }

  /**
   * Called by BugModel whenever a bug annotation is updated. Update the bug row on the thread.
   * @argument {Object} data - Annotation change details.
   * @argument {Proxy} data.bug - Changed bug.
   * @argument {String} data.type - Annotation type such as 'starred' or 'unread'.
   * @argument {Boolean} data.value - New annotation value.
   * @return {undefined}
   */
  on_annotation_updated (data) {
    let $row = this.$$grid.view.$body.querySelector(`[role="row"][data-id="${data.bug.id}"]`);

    if ($row) {
      $row.setAttribute(`data-${data.type}`, data.value);

      if (data.type === 'starred') {
        $row.querySelector('[data-id="starred"] [role="checkbox"]').setAttribute('aria-checked', data.value);
      }
    }
  }
}

/**
 * Define the Vertical Thread View that represents a modern linear thread.
 * @extends BzDeck.ThreadView
 */
BzDeck.VerticalThreadView = class VerticalThreadView extends BzDeck.ThreadView {
  /**
   * Get a VerticalThreadView instance.
   * @constructor
   * @argument {Object} consumer - View that contains the thread.
   * @argument {String} name - Identifier for the thread.
   * @argument {HTMLElement} $outer - Element that contains a child element with the listbox role.
   * @argument {Object} options - Extra options for display.
   * @argument {Object} options.sort_conditions - Thread sorting conditions.
   * @return {Object} view - New VerticalThreadView instance.
   */
  constructor (consumer, name, $outer, options) {
    super(); // This does nothing but is required before using `this`

    let mobile = this.helpers.env.device.mobile;

    this.consumer = consumer;
    this.name = name;
    this.options = options;

    this.$outer = $outer;
    this.$listbox = $outer.querySelector('[role="listbox"]');
    this.$$listbox = new this.widgets.ListBox(this.$listbox, []);
    this.$option = this.get_template('vertical-thread-item');
    this.$$scrollbar = new this.widgets.ScrollBar($outer);
    this.$scrollable_area = mobile ? $outer.querySelector('.scrollable-area-content') : $outer;

    this.$$listbox.bind('dblclick', event => this.ondblclick(event, '[role="option"]'));
    this.$$listbox.bind('Selected', event => {
      if (!event.detail.ids.length) {
        return;
      }

      this.onselect(event);

      // Create a marquee effect when the bug title is overflowing
      for (let $option of event.detail.items) {
        let $name = $option.querySelector('[itemprop="summary"]'),
            width = $name.scrollWidth;

        if (width > $name.clientWidth) {
          let name = `${$option.id}-name-marquee`,
              sheet = document.styleSheets[1];

          // Delete the rule first in case of any width changes
          for (let [index, rule] of Object.entries(sheet.cssRules)) {
            if (rule.type === 7 && rule.name === name) {
              sheet.deleteRule(index);
              break;
            }
          }

          sheet.insertRule(`@keyframes ${name} { 0%, 10% { text-indent: 0 } 100% { text-indent: -${width+10}px } }`, 0);
          $name.style.setProperty('animation-name', name);
          $name.style.setProperty('animation-duration', `${width/25}s`);
        }
      }
    });

    this.$$listbox.assign_key_bindings({
      // Show previous bug, an alias of UP
      B: event => this.helpers.kbd.dispatch(this.$listbox, 'ArrowUp'),
      // Show next bug, an alias of DOWN
      F: event => this.helpers.kbd.dispatch(this.$listbox, 'ArrowDown'),
      // Toggle read
      M: event => {
        for (let $item of this.$$listbox.view.selected) {
          BzDeck.collections.bugs.get(Number($item.dataset.id)).then(bug => {
            bug.unread = $item.dataset.unread === 'false';
          });
        }
      },
      // Toggle star
      S: event => {
        for (let $item of this.$$listbox.view.selected) {
          BzDeck.collections.bugs.get(Number($item.dataset.id)).then(bug => {
            bug.starred = $item.querySelector('[itemprop="starred"]').matches('[aria-checked="false"]');
          });
        }
      },
      // Open the bug in a new tab
      'O|Enter': event => {
        this.open_bug(this.consumer.controller.data.preview_id);
      },
    });

    this.subscribe('BugModel:AnnotationUpdated', true);

    // Lazy loading while scrolling
    this.$scrollable_area.addEventListener('scroll', event => {
      if (this.unrendered_bugs.length && event.target.scrollTop === event.target.scrollTopMax) {
        this.helpers.event.async(() => this.render());
      }
    });
  }

  /**
   * Update the thread with the specified bugs.
   * @argument {Map.<Number, Proxy>} bugs - List of bugs to render.
   * @return {undefined}
   */
  update (bugs) {
    let cond = this.options.sort_conditions;

    this.unrendered_bugs = cond ? this.helpers.array.sort([...bugs.values()], cond) : [...bugs.values()];
    this.$outer.setAttribute('aria-busy', 'true');
    this.$listbox.innerHTML = '';

    this.helpers.event.async(() => {
      this.render();
      this.$listbox.dispatchEvent(new CustomEvent('Updated'));
      this.$outer.removeAttribute('aria-busy');
      this.$scrollable_area.scrollTop = 0;
    });
  }

  /**
   * Render thread items using a custom template.
   * @argument {undefined}
   * @return {undefined}
   */
  render () {
    let bugs = this.unrendered_bugs.splice(0, 50),
        $fragment = new DocumentFragment();

    Promise.all(bugs.map(bug => {
      // TODO: combine primary participants' avatars/initials (#124)
      let contributor = bug.comments ? bug.comments[bug.comments.length - 1].creator : bug.creator;
      return BzDeck.collections.users.get(contributor, { name: contributor });
    })).then(contributors => bugs.forEach((bug, index) => {
      $fragment.appendChild(this.fill(this.$option.cloneNode(true), {
        id: bug.id,
        summary: bug.summary,
        last_change_time: bug.last_change_time,
        contributor: contributors[index].properties,
        starred: bug.starred,
      }, {
        id: `${this.name}-vertical-thread-bug-${bug.id}`,
        'data-id': bug.id,
        'data-unread': !!bug.unread,
      }));
    })).then(() => {
      this.$listbox.appendChild($fragment);
      this.$listbox.dispatchEvent(new CustomEvent('Rendered'));
      this.$$listbox.update_members();
      this.$$scrollbar.set_height();
    });
  }

  /**
   * Called by BugModel whenever a bug annotation is updated. Update the bug item on the thread.
   * @argument {Object} data - Annotation change details.
   * @argument {Proxy} data.bug - Changed bug.
   * @argument {String} data.type - Annotation type such as 'starred' or 'unread'.
   * @argument {Boolean} data.value - New annotation value.
   * @return {undefined}
   */
  on_annotation_updated (data) {
    let $option = this.$listbox.querySelector(`[role="option"][data-id="${data.bug.id}"]`);

    if ($option) {
      $option.setAttribute(`data-${data.type}`, data.value);

      if (data.type === 'starred') {
        let $checkbox = $option.querySelector('[itemprop="starred"]');

        $checkbox.setAttribute('aria-checked', data.value);
        $checkbox.setAttribute('content', data.value);
      }
    }
  }
}
