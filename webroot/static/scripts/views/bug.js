/**
 * BzDeck Bug Panes
 * Copyright © 2015 Kohei Yoshino. All rights reserved.
 */

'use strict';

let BzDeck = BzDeck || {};

BzDeck.views = BzDeck.views || {};

/* ------------------------------------------------------------------------------------------------------------------
 * Bug View
 * ------------------------------------------------------------------------------------------------------------------ */

BzDeck.views.Bug = function Bug ($bug) {
  this.$bug = $bug;

  // Custom scrollbars
  this.scrollbars = new Set([for ($area of this.$bug.querySelectorAll('[role="region"]'))
                                  new FlareTail.widget.ScrollBar($area)]);

  window.addEventListener('Bug:StarToggled', event => {
    let _bug = event.detail.bug,
        _starred = _bug._starred_comments;

    if (this.$bug && _bug.id === this.bug.id) {
      this.$bug.querySelector('header [role="button"][data-command="star"]')
               .setAttribute('aria-pressed', !!_starred.size);

      for (let $comment of this.$bug.querySelectorAll('[role="article"] [itemprop="comment"][data-id]')) {
        $comment.querySelector('[role="button"][data-command="star"]')
                .setAttribute('aria-pressed', _starred.has(Number.parseInt($comment.dataset.id)));
      }
    }
  });

  window.addEventListener('Bug:Updated', event => {
    if (event.detail.bug.id === this.bug.id) {
      this.update(event.detail.bug, event.detail.changes);
    }
  });
};

BzDeck.views.Bug.prototype.fill = function (bug, partial = false) {
  this.bug = bug;
  this.$bug.dataset.id = this.bug.id;

  if (!this.bug.summary && !this.bug._update_needed) {
    // The bug is being loaded
    return;
  }

  let _bug = {};

  for (let { 'id': field, type } of BzDeck.config.grid.default_columns) {
    if (this.bug[field] !== undefined && !field.startsWith('_')) {
      if (field === 'keywords') {
        _bug.keyword = this.bug.keywords;
      } else if (field === 'mentors') {
        _bug.mentor = [for (person of this.bug.mentors_detail) {
          'name': BzDeck.controllers.users.get_name(person),
          'email': person.email,
          'image': 'https://secure.gravatar.com/avatar/' + md5(person.email) + '?d=mm'
        }];
      } else if (type === 'person') {
        if (this.bug[field]) {
          let person = this.bug[`${field}_detail`];

          _bug[field] = {
            'name': BzDeck.controllers.users.get_name(person),
            'email': person.email,
            'image': 'https://secure.gravatar.com/avatar/' + md5(person.email) + '?d=mm'
          };
        }
      } else {
        _bug[field] = this.bug[field] || '';
      }
    }
  }

  FlareTail.util.content.render(this.$bug, _bug);

  this.set_product_tooltips();

  let $button = this.$bug.querySelector('[role="button"][data-command="star"]'),
      $timeline = this.$bug.querySelector('.bug-timeline');

  // Star on the header
  if ($button) {
    $button.setAttribute('aria-pressed', BzDeck.controllers.bugs.is_starred(this.bug));
    (new FlareTail.widget.Button($button)).bind('Pressed', event =>
      BzDeck.controllers.bugs.toggle_star(this.bug.id, event.detail.pressed));
  }

  if (!$timeline) {
    return;
  }

  $timeline.setAttribute('aria-busy', 'true');
  BzDeck.views.core.show_status('Loading...'); // l10n

  // Empty timeline while keeping the scrollbar
  if (!partial) {
    for (let $comment of $timeline.querySelectorAll('[itemprop="comment"], [role="form"], .read-comments-expander')) {
      $comment.remove();
    }
  }

  if (this.bug.comments && !this.bug._update_needed || partial) {
    FlareTail.util.event.async(() => this.fill_details(partial, false));
  } else {
    // Load comments, history, flags and attachments' metadata
    BzDeck.controllers.bugs.fetch_bug(this.bug.id, false).then(bug_details => { // Exclude metadata
      this.bug = Object.assign(this.bug, bug_details); // Merge data
      BzDeck.model.save_bug(this.bug);
      FlareTail.util.event.async(() => this.fill_details(false, true));
    });
  }

  // Focus management
  let set_focus = shift => {
    let ascending = BzDeck.model.data.prefs['ui.timeline.sort.order'] !== 'descending',
        entries = [...$timeline.querySelectorAll('[itemprop="comment"]')];

    entries = ascending && shift || !ascending && !shift ? entries.reverse() : entries;

    // Focus the first (or last) visible entry
    for (let $_entry of entries) if ($_entry.clientHeight) {
      $_entry.focus();
      $_entry.scrollIntoView(ascending);

      break;
    }
  };

  // Assign keyboard shortcuts
  if (!$timeline.hasAttribute('keyboard-shortcuts-enabled')) {
    FlareTail.util.kbd.assign($timeline, {
      // Toggle read
      'M': event => BzDeck.controllers.bugs.toggle_unread(this.bug.id, !this.bug._unread),
      // Toggle star
      'S': event => BzDeck.controllers.bugs.toggle_star(this.bug.id, !BzDeck.controllers.bugs.is_starred(this.bug)),
      // Reply
      'R': event => document.querySelector(`#${$timeline.id}-comment-form [role="textbox"]`).focus(),
      // Focus management
      'PAGE_UP|SHIFT+SPACE': event => set_focus(true),
      'PAGE_DOWN|SPACE': event => set_focus(false),
    });

    $timeline.setAttribute('keyboard-shortcuts-enabled', 'true');
  }
};

BzDeck.views.Bug.prototype.fill_details = function (partial, delayed) {
  // When the comments and history are loaded async, the template can be removed
  // or replaced at the time of call, if other bug is selected by user
  if (!this.$bug || Number.parseInt(this.$bug.dataset.id) !== this.bug.id) {
    return;
  }

  let _bug = {
    'cc': [for (person of this.bug.cc_detail) {
      'name': BzDeck.controllers.users.get_name(person).replace(/\s?[\[\(].*[\)\]]/g, ''), // Remove bracketed strings
      'email': person.email,
      'image': 'https://secure.gravatar.com/avatar/' + md5(person.email) + '?d=mm'
    }],
    'depends_on': this.bug.depends_on,
    'blocks': this.bug.blocks,
    'see_also': this.bug.see_also,
    'flag': [for (flag of this.bug.flags) {
      'creator': {
        'name': flag.setter, // email
        'email': flag.setter
      },
      'name': flag.name,
      'status': flag.status
    }]
  };

  if (this.bug.dupe_of) {
    _bug.resolution = `DUPLICATE of ${this.bug.dupe_of}`;
  }

  FlareTail.util.content.render(this.$bug, _bug);

  // Depends on & Blocks
  for (let $li of this.$bug.querySelectorAll('[itemprop="depends_on"], [itemprop="blocks"]')) {
    $li.setAttribute('data-bug-id', $li.itemValue);

    (new FlareTail.widget.Button($li)).bind('Pressed', event =>
      BzDeck.router.navigate('/bug/' + event.target.textContent));
  }

  // See Also
  for (let $link of this.$bug.querySelectorAll('[itemprop="see_also"]')) {
    let re = new RegExp(`^${BzDeck.model.data.server.url}/show_bug.cgi\\?id=(\\d+)$`.replace(/\./g, "\\.")),
        match = $link.href.match(re);

    if (match) {
      $link.text = match[1];
      $link.setAttribute('data-bug-id', match[1]);
      $link.setAttribute('role', 'button');
    } else {
      $link.text = $link.href;
    }
  }

  // Flags
  let $flags = this.$bug.querySelector('[data-field="flags"]');

  if ($flags) {
    $flags.setAttribute('aria-hidden', !this.bug.flags.length);
  }

  // TODO: Show Project Flags and Tracking Flags

  if (!partial) {
    FlareTail.util.event.async(() => {
      // Timeline: comments, attachments & history
      this.timeline = new BzDeck.views.Bug.Timeline(this.bug, this.$bug, delayed);

      // Attachments and History, only on the details tabs
      BzDeck.views.DetailsPage.attachments.render(this.$bug, this.bug.attachments);
      BzDeck.views.DetailsPage.history.render(this.$bug, this.bug.history);

      // Add tooltips to the related bugs
      this.set_bug_tooltips();

      // Force updating the scrollbars because sometimes those are not automatically updated
      this.scrollbars.forEach($$scrollbar => $$scrollbar.set_height());
    });
  }

  BzDeck.views.core.show_status('');
};

BzDeck.views.Bug.prototype.set_product_tooltips = function () {
  let config = BzDeck.model.data.server.config,
      strip_tags = str => FlareTail.util.string.strip_tags(str).replace(/\s*\(more\ info\)$/i, ''),
      classification = config.classification[this.bug.classification],
      product = config.product[this.bug.product],
      component,
      $classification = this.$bug.querySelector('[itemprop="classification"]'),
      $product = this.$bug.querySelector('[itemprop="product"]'),
      $component;

  if ($classification && classification) {
    $classification.title = strip_tags(classification.description);
  }

  if (!product) {
    return;
  }

  if ($product) {
    $product.title = strip_tags(product.description);
  }

  component = product.component[this.bug.component];
  $component = this.$bug.querySelector('[itemprop="component"]');

  if ($component && component) {
    $component.title = strip_tags(component.description);
  }
};

BzDeck.views.Bug.prototype.set_bug_tooltips = function () {
  let related_bug_ids = new Set([for ($element of this.$bug.querySelectorAll('[data-bug-id]'))
                                Number.parseInt($element.getAttribute('data-bug-id'))]);
  let set_tooltops = bug => {
    if (bug.summary) {
      let title = `${bug.status} ${bug.resolution || ''} – ${bug.summary}`;

      for (let $element of this.$bug.querySelectorAll(`[data-bug-id="${bug.id}"]`)) {
        $element.title = title;
        $element.dataset.status = bug.status;
        $element.dataset.resolution = bug.resolution || '';
      }
    }
  };

  if (related_bug_ids.size) {
    BzDeck.model.get_bugs_by_ids(related_bug_ids).then(bugs => {
      let found_bug_ids = [for (bug of bugs) bug.id],
          lookup_bug_ids = [for (id of related_bug_ids) if (!found_bug_ids.includes(id)) id];

      bugs.map(set_tooltops);

      if (lookup_bug_ids.length) {
        BzDeck.controllers.bugs.fetch_bugs(lookup_bug_ids).then(bugs => {
          BzDeck.model.save_bugs(bugs);
          bugs.map(set_tooltops);
        });
      }
    });
  }
};

BzDeck.views.Bug.prototype.update = function (bug, changes) {
  this.bug = bug;

  let $timeline = this.$bug.querySelector('.bug-timeline');

  if ($timeline) {
    $timeline.querySelector('.comments-wrapper')
             .appendChild(new BzDeck.views.Bug.Timeline.Entry($timeline.id, this.bug, changes)).scrollIntoView();
  }

  if (changes.has('attachment') && this.$bug.querySelector('[data-field="attachments"]')) {
    BzDeck.views.DetailsPage.attachments.render(this.$bug, [changes.get('attachment')], true);
  }

  if (changes.has('history') && this.$bug.querySelector('[data-field="history"]')) {
    let _bug = { 'id': this.bug.id, '_update_needed': true };

    // Prep partial data
    for (let change in changes.get('history').changes) {
      _bug[change.field_name] = this.bug[change.field_name];
    }

    this.fill(_bug, true);
    BzDeck.views.DetailsPage.history.render(this.$bug, [changes.get('history')], true);
  }
};

BzDeck.views.Bug.find_person = function (bug, email) {
  if (bug.creator === email) {
    return bug.creator_detail;
  }

  if (bug.assigned_to === email) {
    return bug.assigned_to_detail;
  }

  if (bug.qa_contact === email) {
    return bug.qa_contact_detail;
  }

  if (bug.cc.includes(email)) {
    return [for (person of bug.cc_detail) if (person.email === email) person][0];
  }

  if (bug.mentors.includes(email)) {
    return [for (person of bug.mentors_detail) if (person.email === email) person][0];
  }

  // If the person is just watching the bug component, s/he might not be in any field of the bug
  // and cannot be found. Then just return a simple object. TODO: fetch the account using the API
  return { email, 'id': 0, 'name': email, 'real_name': '' };
};

/* ------------------------------------------------------------------------------------------------------------------
 * Timeline
 * ------------------------------------------------------------------------------------------------------------------ */

BzDeck.views.Bug.Timeline = function Timeline (bug, $bug, delayed) {
  let get_time = str => (new Date(str)).getTime(),
      entries = new Map([for (c of bug.comments.entries())
                             [get_time(c[1].creation_time), new Map([['comment', c[1]], ['comment_number', c[0]]])]]),
      prefs = BzDeck.model.data.prefs,
      show_cc_changes = prefs['ui.timeline.show_cc_changes'] === true,
      click_event_type = FlareTail.util.ua.touch.enabled ? 'touchstart' : 'mousedown',
      read_comments_num = 0,
      last_comment_time,
      $timeline = $bug.querySelector('.bug-timeline'),
      timeline_id = $timeline.id = `${$bug.id}-timeline`,
      comment_form = new BzDeck.views.Bug.Timeline.CommentForm(bug, timeline_id),
      $expander,
      $fragment = new DocumentFragment(),
      $comments_wrapper = $timeline.querySelector('.comments-wrapper'),
      $parent = $timeline.querySelector('.scrollable-area-content');

  for (let attachment of bug.attachments) {
    entries.get(get_time(attachment.creation_time)).set('attachment', attachment);
  }

  for (let history of bug.history) if (entries.has(get_time(history.when))) {
    entries.get(get_time(history.when)).set('history', history);
  } else {
    entries.set(get_time(history.when), new Map([['history', history]]));
  }

  // Sort by time
  entries = new Map([for (entry of entries) [entry[0], entry[1]]].sort((a, b) => a[0] > b[0]));

  // Collapse read comments
  // If the fill_bug_details function is called after the bug details are fetched,
  // the _last_viewed annotation is already true, so check the delayed argument here
  for (let [time, data] of entries) {
    if (!delayed && bug._last_viewed && time < bug._last_viewed) {
      if (data.has('comment')) {
        read_comments_num++;
        last_comment_time = time;
      }
    } else {
      data.set('rendering', true);
    }
  }

  // Generate entries
  for (let [time, data] of entries) if (data.has('rendering') || time >= last_comment_time) {
    $fragment.appendChild(new BzDeck.views.Bug.Timeline.Entry(timeline_id, bug, data));
    data.delete('rendering');
    data.set('rendered', true);
  }

  // Append entries to the timeline
  $comments_wrapper.appendChild($fragment);

  // Show an expander if there are read comments
  if (read_comments_num > 1) {
    // The last comment is rendered, so decrease the number
    read_comments_num--;

    $expander = document.createElement('div');
    $expander.textContent = read_comments_num === 1 ? '1 older comment'
                                                    : `${read_comments_num} older comments`; // l10n
    $expander.className = 'read-comments-expander';
    $expander.tabIndex = 0;
    $expander.setAttribute('role', 'button');
    $expander.addEventListener(click_event_type, event => {
      $expander.textContent = 'Loading...'; // l10n
      $fragment = new DocumentFragment();

      for (let [time, data] of entries) if (!data.get('rendered')) {
        $fragment.appendChild(new BzDeck.views.Bug.Timeline.Entry(timeline_id, bug, data));
        data.set('rendered', true);
      }

      $timeline.focus();
      $comments_wrapper.replaceChild($fragment, $expander);

      return FlareTail.util.event.ignore(event);
    });
    $comments_wrapper.insertBefore($expander, $comments_wrapper.querySelector('[itemprop="comment"]'));
  }

  let $existing_form = $timeline.parentElement.querySelector('[id$="comment-form"]');

  if ($existing_form) {
    $existing_form.remove();
  }

  // Add a comment form
  $timeline.parentElement.appendChild(comment_form.$form);
  $parent.scrollTop = 0;
  $timeline.removeAttribute('aria-busy', 'false');

  let check_fragment = () => {
    let match = location.hash.match(/^#c(\d+)$/),
        comment_number = match ? Number.parseInt(match[1]) : undefined;

    // If the URL fragment has a valid comment number, scroll the comment into view
    if (location.pathname === `/bug/${bug.id}` && comment_number) {
      let $comment = $timeline.querySelector(`[data-comment-number="${comment_number}"]`);

      if ($comment) {
        if ($expander) {
          // Expand all comments
          $expander.dispatchEvent(new CustomEvent(click_event_type));
        }

        $comment.scrollIntoView();
        $comment.focus();
      }
    }
  };

  // Check the fragment; use a timer to wait for rendering
  window.setTimeout(window => check_fragment(), 150);
  window.addEventListener('popstate', event => check_fragment());
  window.addEventListener('hashchange', event => check_fragment());
};

BzDeck.views.Bug.Timeline.Entry = function Entry (timeline_id, bug, data) {
  let datetime = FlareTail.util.datetime,
      click_event_type = FlareTail.util.ua.touch.enabled ? 'touchstart' : 'mousedown',
      author,
      time,
      comment = data.get('comment'),
      attachment = data.get('attachment'),
      history = data.get('history'),
      $entry = FlareTail.util.content.get_fragment('timeline-comment').firstElementChild,
      $header = $entry.querySelector('header'),
      $author = $entry.querySelector('[itemprop="author"]'),
      $time = $entry.querySelector('[itemprop="datePublished"]'),
      $star_button = $entry.querySelector('[role="button"][data-command="star"]'),
      $reply_button = $entry.querySelector('[data-command="reply"]'),
      $comment = $entry.querySelector('[itemprop="text"]'),
      $changes = $entry.querySelector('.changes'),
      $textbox = document.querySelector(`#${timeline_id}-comment-form [role="textbox"]`);

  if (comment) {
    // TEMP: the message for a duplicated bug is currently only in the comment.text field
    let text = comment.text.includes('has been marked as a duplicate of this bug')
             ? comment.text : comment.raw_text;

    comment.number = data.get('comment_number');
    author = BzDeck.views.Bug.find_person(bug, comment.creator);
    time = comment.creation_time;
    $entry.id = `${timeline_id}-comment-${comment.id}`;
    $entry.dataset.id = comment.id;
    $entry.dataset.time = (new Date(time)).getTime();
    $entry.setAttribute('data-comment-number', comment.number);
    $comment.innerHTML = text ? BzDeck.controllers.core.parse_comment(text) : '';

    // Append the comment number to the URL when clicked
    $entry.addEventListener(click_event_type, event => {
      if (location.pathname.startsWith('/bug/')) {
        window.history.replaceState({}, document.title, `${location.pathname}#c${comment.number}`);
      }
    });

    let toggle_star = () => {
      if (!bug._starred_comments) {
        bug._starred_comments = new Set([comment.id]);
      } else if (bug._starred_comments.has(comment.id)) {
        bug._starred_comments.delete(comment.id);
      } else {
        bug._starred_comments.add(comment.id);
      }

      BzDeck.model.save_bug(bug);
      FlareTail.util.event.trigger(window, 'Bug:StarToggled', { 'detail': { bug }});
    };

    let reply = () => {
      let quote_header = `(In reply to ${author.real_name || author.email} from comment #${comment.number})`,
          quote_lines = [for (line of text.match(/^$|.{1,78}(?:\b|$)/gm) || []) `> ${line}`],
          quote = `${quote_header}\n${quote_lines.join('\n')}`,
          $tabpanel = document.querySelector(`#${timeline_id}-comment-form-tabpanel-write`),
          $textbox = document.querySelector(`#${timeline_id}-comment-form [role="textbox"]`);

      $textbox.focus();
      $textbox.value += `${$textbox.value ? '\n\n' : ''}${quote}\n\n`;
      // Trigger an event to do something. Disable async to make sure the following lines work
      FlareTail.util.event.trigger($textbox, 'input', {}, false);
      // Scroll unti the caret is visible
      $tabpanel.scrollTop = $tabpanel.scrollHeight;
      $entry.scrollIntoView();
    };

    // Activate the buttons
    $star_button.addEventListener(click_event_type, event => { toggle_star(); event.stopPropagation(); });
    $star_button.setAttribute('aria-pressed', !!bug._starred_comments && bug._starred_comments.has(comment.id));
    $reply_button.addEventListener(click_event_type, event => { reply(); event.stopPropagation(); });

    // Assign keyboard shortcuts
    FlareTail.util.kbd.assign($entry, {
      'R': event => reply(),
      'S': event => toggle_star(),
    });
  } else {
    $entry.dataset.nocomment = true;
    $star_button.setAttribute('aria-hidden', 'true');
    $reply_button.setAttribute('aria-hidden', 'true');
    $comment.remove();
  }

  if (attachment) {
    // TODO: load the attachment data via API
    let url = `${BzDeck.model.data.server.url}/attachment.cgi?id=${attachment.id}`,
        media_type = attachment.content_type.split('/')[0],
        $attachment = FlareTail.util.content.get_fragment('timeline-attachment').firstElementChild,
        $outer = $attachment.querySelector('div'),
        $media,
        load_event = 'load';

    FlareTail.util.content.render($attachment, {
      'url': `/attachment/${attachment.id}`,
      'description': attachment.summary,
      'name': attachment.file_name,
      'contentSize': attachment.size,
      'contentUrl': url,
      'encodingFormat': attachment.is_patch ? '' : attachment.content_type
    }, {
      'data-attachment-id': attachment.id
    }),

    $attachment.title = [
      attachment.summary,
      attachment.file_name,
      attachment.is_patch ? 'Patch' : attachment.content_type, // l10n
      `${(attachment.size / 1024).toFixed(2)} KB` // l10n
    ].join('\n');

    if (media_type === 'image') {
      $media = document.createElement('img');
      $media.alt = attachment.summary;
    }

    if (media_type === 'audio' || media_type === 'video') {
      $media = document.createElement(media_type);
      $media.controls = true;
      load_event = 'loadedmetadata';

      if ($media.canPlayType(attachment.content_type) === '') {
        $media = null; // Cannot play the media
      }
    }

    if ($media) {
      $outer.appendChild($media);
      $media.addEventListener(load_event, event => $outer.removeAttribute('aria-busy'));

      if (BzDeck.model.data.prefs['ui.timeline.display_attachments_inline'] !== false) {
        $outer.setAttribute('aria-busy', 'true');
        $media.src = url;
      }
    } else {
      // TODO: support other attachment types
      $outer.remove();
    }

    $entry.insertBefore($attachment, $changes);
  }

  if (history) {
    let conf_field = BzDeck.model.data.server.config.field;

    let generate_element = (change, how) => {
      let $elm = document.createElement('span');

      if (['blocks', 'depends_on'].includes(change.field_name)) {
        $elm.innerHTML = change[how].replace(/(\d+)/g, '<a href="/bug/$1" data-bug-id="$1">$1</a>');
      } else {
        $elm.textContent = change[how];
      }

      $elm.setAttribute('data-how', how);

      return $elm;
    };

    author = author || BzDeck.views.Bug.find_person(bug, history.who);
    time = time || history.when;
    $entry.dataset.changes = [for (change of history.changes) change.field_name].join(' ');

    for (let change of history.changes) {
      let $change = $changes.appendChild(document.createElement('li')),
          _field = conf_field[change.field_name] ||
                   // Bug 909055 - Field name mismatch in history: group vs groups
                   conf_field[change.field_name.replace(/s$/, '')] ||
                   // Bug 1078009 - Changes/history now include some wrong field names
                   conf_field[{
                     'flagtypes.name': 'flag',
                     'attachments.description': 'attachment.description',
                     'attachments.ispatch': 'attachment.is_patch',
                     'attachments.isobsolete': 'attachment.is_obsolete',
                     'attachments.isprivate': 'attachment.is_private',
                     'attachments.mimetype': 'attachment.content_type',
                   }[change.field_name]] ||
                   // If the Bugzilla config is outdated, the field name can be null
                   change;

      $change.textContent = `${_field.description || _field.field_name}: `;
      $change.setAttribute('data-change-field', change.field_name);

      if (change.removed) {
        $change.appendChild(generate_element(change, 'removed'));
      }

      if (change.removed && change.added) {
        $change.appendChild(document.createTextNode(' → '));
      }

      if (change.added) {
        $change.appendChild(generate_element(change, 'added'));
      }
    }
  } else {
    $changes.remove();
  }

  // Focus management
  let move_focus = shift => {
    if (!$entry.matches(':focus')) {
      $entry.focus();
      $entry.scrollIntoView(ascending);

      return;
    }

    let ascending = BzDeck.model.data.prefs['ui.timeline.sort.order'] !== 'descending',
        entries = [...document.querySelectorAll(`#${timeline_id} [itemprop="comment"]`)];

    entries = ascending && shift || !ascending && !shift ? entries.reverse() : entries;
    entries = entries.slice(entries.indexOf($entry) + 1);

    // Focus the next (or previous) visible entry
    for (let $_entry of entries) if ($_entry.clientHeight) {
      $_entry.focus();
      $_entry.scrollIntoView(ascending);

      break;
    }
  };

  $author.title = `${author.real_name ? author.real_name + '\n' : ''}${author.email}`;
  $author.querySelector('[itemprop="name"]').itemValue = author.real_name || author.email;
  $author.querySelector('[itemprop="email"]').itemValue = author.email;
  BzDeck.views.core.set_avatar(author, $author.querySelector('[itemprop="image"]'));
  datetime.fill_element($time, time);

  // Mark unread
  $entry.setAttribute('data-unread', 'true');

  // Collapse/expand the comment
  let collapse_comment = () => $entry.setAttribute('aria-expanded', $entry.getAttribute('aria-expanded') === 'false');

  // Assign keyboard shortcuts
  FlareTail.util.kbd.assign($entry, {
    // Collapse/expand the comment
    'C': event => collapse_comment(),
    // Focus management
    'UP|PAGE_UP|SHIFT+SPACE': event => move_focus(true),
    'DOWN|PAGE_DOWN|SPACE': event => move_focus(false),
  });

  // Click the header to collapse/expand the comment
  // TODO: Save the state in DB
  $entry.setAttribute('aria-expanded', 'true');
  $header.addEventListener(click_event_type, event => {
    if (event.target === $header) {
      collapse_comment();
    }
  });

  return $entry;
};

BzDeck.views.Bug.Timeline.CommentForm = function CommentForm (bug, timeline_id) {
  let click_event_type = FlareTail.util.ua.touch.enabled ? 'touchstart' : 'mousedown',
      $fragment = FlareTail.util.content.get_fragment('timeline-comment-form', timeline_id);

  this.$form = $fragment.firstElementChild;
  this.$tabpanel = this.$form.querySelector('[role="tabpanel"]');
  this.$textbox = this.$form.querySelector('[id$="tabpanel-write"] [role="textbox"]');
  this.$$tabs = new FlareTail.widget.TabList(this.$form.querySelector('[role="tablist"]'));
  this.$write_tab = this.$form.querySelector('[id$="tab-write"]');
  this.$preview_tab = this.$form.querySelector('[id$="tab-preview"]');
  this.$attachments_tab = this.$form.querySelector('[id$="tab-attachments"]');
  this.$preview = this.$form.querySelector('[id$="tabpanel-preview"] [itemprop="text"]');
  this.$status = this.$form.querySelector('[role="status"]');
  this.$attach_button = this.$form.querySelector('[data-command="attach"]');
  this.$file_picker = this.$form.querySelector('input[type="file"]');
  this.$attachments_tbody = this.$form.querySelector('[id$="tabpanel-attachments"] tbody');
  this.$attachments_row_tmpl = document.querySelector('#timeline-comment-form-attachments-row');
  this.$parallel_checkbox = this.$form.querySelector('[role="checkbox"]');
  this.$drop_target = this.$form.querySelector('[aria-dropeffect]');
  this.$submit = this.$form.querySelector('[data-command="submit"]');

  this.bug = bug;
  this.has_token = () => !!BzDeck.model.data.account.token;
  this.has_text = () => !!this.$textbox.value.match(/\S/);
  this.attachments = [];
  this.has_attachments = () => this.attachments.length > 0;
  this.parallel_upload = true;

  this.$form.addEventListener('wheel', event => event.stopPropagation());

  this.$$tabs.bind('Selected', event => {
    let tab_id = event.detail.items[0].id;

    if (tab_id.endsWith('write')) {
      this.$textbox.focus();
    }

    if (tab_id.endsWith('preview')) {
      this.$preview.innerHTML = BzDeck.controllers.core.parse_comment(this.$textbox.value);
    }
  });

  for (let $tabpanel of this.$form.querySelectorAll('[role="tabpanel"]')) {
    new FlareTail.widget.ScrollBar($tabpanel);
  }

  // Workaround a Firefox bug: the placeholder is not displayed in some cases
  this.$textbox.value = '';

  // Assign keyboard shortcuts
  FlareTail.util.kbd.assign(this.$textbox, {
    'ACCEL+RETURN': event => {
      if (this.has_text() && this.has_token()) {
        this.submit();
      }
    },
  });

  this.$textbox.addEventListener('input', event => this.oninput());

  // Attach files using a file picker
  // The event here should be click; others including touchstart and mousedown don't work
  this.$attach_button.addEventListener('click', event => this.$file_picker.click());
  this.$file_picker.addEventListener('change', event => this.onselect_files(event.target.files));

  // Attach files by drag & drop
  this.$form.addEventListener('dragover', event => {
    event.dataTransfer.dropEffect = 'copy';
    event.dataTransfer.effectAllowed = 'copy';
    event.preventDefault();

    this.$drop_target.setAttribute('aria-dropeffect', 'copy');
  });

  this.$form.addEventListener('drop', event => {
    let dt = event.dataTransfer;

    if (dt.types.contains('Files')) {
      this.onselect_files(dt.files);
    } else if (dt.types.contains('text/plain')) {
      this.attach_text(dt.getData('text/plain'));
    }

    this.$drop_target.setAttribute('aria-dropeffect', 'none');

    event.preventDefault();
  });

  (new FlareTail.widget.Checkbox(this.$parallel_checkbox)).bind('Toggled', event => {
    this.parallel_upload = event.detail.checked;
    this.update_parallel_ui();
  });

  this.$submit.addEventListener(click_event_type, event => this.submit());

  if (!this.has_token()) {
    this.$status.innerHTML = '<strong>Provide your auth token</strong> to post.';
    this.$status.querySelector('strong').addEventListener(click_event_type, event =>
      BzDeck.router.navigate('/settings', { 'tab_id': 'account' }));

    window.addEventListener('Account:AuthTokenVerified', event => {
      this.$status.textContent = '';
      this.$submit.setAttribute('aria-disabled', !this.has_text() || !this.has_attachments());
    });
  }
};

BzDeck.views.Bug.Timeline.CommentForm.prototype.oninput = function () {
  this.$textbox.style.removeProperty('height');
  this.$textbox.style.setProperty('height', `${this.$textbox.scrollHeight}px`);
  this.$submit.setAttribute('aria-disabled', !(this.has_text() || this.has_attachments()) || !this.has_token());
  this.$preview_tab.setAttribute('aria-disabled', !this.has_text());

  if (this.has_token() && this.$status.textContent) {
    this.$status.textContent = '';
  }
};

BzDeck.views.Bug.Timeline.CommentForm.prototype.attach_text = function (str) {
  let reader = new FileReader(),
      blob = new Blob([str], { type: 'text/plain' }),
      is_ghpr = str.match(/^https:\/\/github\.com\/(.*)\/pull\/(\d+)$/),
      is_patch = str.match(/^diff\s/m);

  // Use FileReader instead of btoa() to avoid overflow
  reader.addEventListener('load', event => {
    this.add_attachment({
      'data': reader.result.replace(/^.*?,/, ''), // Drop data:text/plain;base64,
      'summary': is_ghpr ? `GitHub Pull Request, ${is_ghpr[1]}#${is_ghpr[2]}`
                         : is_patch ? 'Patch' : str.substr(0, 25) + (str.length > 25 ? '...' : ''),
      'file_name': URL.createObjectURL(blob).match(/\w+$/)[0] + '.txt',
      is_patch,
      'size': blob.size, // Not required for the API but used in find_attachment()
      'content_type': is_ghpr ? 'text/x-github-pull-request' : 'text/plain'
    });
  });

  reader.readAsDataURL(blob);
};

BzDeck.views.Bug.Timeline.CommentForm.prototype.onselect_files = function (files) {
  let excess_files = new Set(),
      num_format = num => num.toLocaleString('en-US'),
      max_size = BzDeck.model.data.server.config.max_attachment_size,
      max = num_format(max_size),
      message;

  for (let _file of files) {
    let reader = new FileReader(),
        file = _file, // Redeclare the variable so it can be used in the following event
        is_patch = /\.(patch|diff)$/.test(file.name) || /^text\/x-(patch|diff)$/.test(file.type);

    // Check if the file has already been attached
    if (this.find_attachment(file) > -1) {
      continue;
    }

    // Check if the file is not exceeding the limit
    if (file.size > max_size) {
      excess_files.add(file);

      continue;
    }

    reader.addEventListener('load', event => {
      this.add_attachment({
        'data': reader.result.replace(/^.*?,/, ''), // Drop data:<type>;base64,
        'summary': is_patch ? 'Patch' : file.name,
        'file_name': file.name,
        is_patch,
        'size': file.size, // Not required for the API but used in find_attachment()
        'content_type': is_patch ? 'text/plain' : file.type || 'application/x-download'
      });
    });

    reader.readAsDataURL(file);
  }

  if (excess_files.size) {
    message = excess_files.size === 1
            ? `This file cannot be attached because it may exceed the maximum attachment size \
               (${max} bytes) specified by the current Bugzilla instance. You can upload the file \
               to an online storage and post the link instead.`
            : `These files cannot be attached because they may exceed the maximum attachment size \
               (${max} bytes) specified by the current Bugzilla instance. You can upload the files \
               to an online storage and post the links instead.`; // l10n
    message += '<br><br>';
    message += [for (file of excess_files) `&middot; ${file.name} (${num_format(file.size)} bytes)`].join('<br>');

    (new FlareTail.widget.Dialog({
      'type': 'alert',
      'title': 'Error on attaching files',
      message
    })).show();
  }
};

BzDeck.views.Bug.Timeline.CommentForm.prototype.add_attachment = function (attachment) {
  let click_event_type = FlareTail.util.ua.touch.enabled ? 'touchstart' : 'mousedown',
      $tbody = this.$attachments_tbody,
      $row = this.$attachments_row_tmpl.content.cloneNode(true).firstElementChild,
      $desc = $row.querySelector('[data-field="description"]');

  this.attachments.push(attachment);

  $desc.value = $desc.placeholder = attachment.summary;
  $desc.addEventListener('keydown', event => event.stopPropagation());
  $desc.addEventListener('input', event => attachment.summary = $desc.value);

  $row.querySelector('[data-command="remove"]').addEventListener(click_event_type, event => {
    this.remove_attachment(attachment);
  });

  $row.querySelector('[data-command="move-up"]').addEventListener(click_event_type, event => {
    let index = this.find_attachment(attachment);

    this.attachments.splice(index - 1, 2, attachment, this.attachments[index - 1]);
    $tbody.insertBefore($row.previousElementSibling, $row.nextElementSibling);
  });

  $row.querySelector('[data-command="move-down"]').addEventListener(click_event_type, event => {
    let index = this.find_attachment(attachment);

    this.attachments.splice(index, 2, this.attachments[index + 1], attachment);
    $tbody.insertBefore($row.nextElementSibling, $row);
  });

  $tbody.appendChild($row);

  this.$attachments_tab.setAttribute('aria-disabled', 'false');
  this.$$tabs.view.selected = this.$attachments_tab;
  this.$submit.setAttribute('aria-disabled', !this.has_token());
  this.update_parallel_ui();
};

BzDeck.views.Bug.Timeline.CommentForm.prototype.remove_attachment = function (attachment) {
  let index = this.find_attachment(attachment);

  this.attachments.splice(index, 1);

  this.$attachments_tbody.rows[index].remove();
  this.$attachments_tab.setAttribute('aria-disabled', !this.has_attachments());
  this.$submit.setAttribute('aria-disabled', !(this.has_text() || this.has_attachments()) || !this.has_token());
  this.update_parallel_ui();

  if (!this.has_attachments()) {
    this.$$tabs.view.selected = this.$write_tab;
  }
};

BzDeck.views.Bug.Timeline.CommentForm.prototype.find_attachment = function (attachment) {
  // A file with the same name and size might be the same file
  let index = [for (entry of this.attachments.entries())
               if (entry[1].file_name === (attachment.file_name || attachment.name) &&
                   entry[1].size === attachment.size) entry[0]][0];

  return index === undefined ? -1 : index;
};

BzDeck.views.Bug.Timeline.CommentForm.prototype.update_parallel_ui = function () {
  let disabled = this.attachments.length < 2 || this.parallel_upload;

  for (let $button of this.$attachments_tbody.querySelectorAll('[data-command|="move"]')) {
    $button.setAttribute('aria-disabled', disabled);
  }

  this.$parallel_checkbox.setAttribute('aria-hidden', this.attachments.length < 2);
};

BzDeck.views.Bug.Timeline.CommentForm.prototype.submit = function () {
  let data,
      hash = att => md5(att.file_name + String(att.size)),
      map_sum = map => [...map.values()].reduce((p, c) => p + c),
      comment = this.$textbox.value,
      att_num = this.attachments.length,
      att_total = 0,
      att_uploaded = new Map([for (att of this.attachments) [hash(att), 0]]),
      percentage;

  let update_status = (att, uploaded) => {
    att_uploaded.set(hash(att), uploaded);
    percentage = Math.round(map_sum(att_uploaded) / att_total * 100);
    this.$status.textContent = `${percentage}% uploaded`;
  };

  let post = data => new Promise((resolve, reject) => {
    let method = data.file_name ? 'attachment' : 'comment',
        length_computable,
        size = 0;

    // If there is no comment, go ahead with attachments
    if (method === 'comment' && !data.comment) {
      resolve();

      return;
    }

    BzDeck.controllers.core.request('POST', `bug/${this.bug.id}/${method}`, null, JSON.stringify(data), {
      'upload': {
        'progress': event => {
          if (method === 'attachment') {
            if (!size) {
              length_computable = event.lengthComputable;
              size = event.total;
              att_total += size;
            }

            if (length_computable) {
              update_status(data, event.loaded);
            }
          }
        }
      }
    }, {
      'auth': true // Enable auth
    }).then(result => {
      if (result.ids) {
        if (method === 'attachment') {
          this.remove_attachment(data);

          if (!length_computable) {
            update_status(data, size);
          }
        }

        resolve();
      } else {
        reject(new Error(result));
      }
    }).catch(event => {
      reject(new Error());
    });
  });

  this.$textbox.setAttribute('aria-readonly', 'true');
  this.$submit.setAttribute('aria-disabled', 'true');
  this.$status.textContent = 'Submitting...';

  if (att_num === 1) {
    // If there's a single attachment, send it with the comment
    data = this.attachments[0];
    data.comment = comment;
  } else {
    // If there's no attachment, just send the comment. If there are 2 or more attachments,
    // send the comment first then send the attachments in parallel
    data = { comment };
  }

  post(data).then(value => {
    if (att_num < 2) {
      return true;
    }

    // Upload files in parallel
    if (this.parallel_upload) {
      return Promise.all([for (att of this.attachments) post(att)]);
    }

    // Upload files in series
    return this.attachments.reduce((sequence, att) => sequence.then(() => post(att)), Promise.resolve());
  }, error => {
    // Failed to post
    this.$submit.setAttribute('aria-disabled', 'false');
    this.$status.textContent = error && error.message ? `ERROR: ${error.message}`
                             : 'Failed to post your comment or attachment. Try again later.';
  }).then(() => {
    // All done, the timeline will soon be updated via Bugzfeed
    this.$textbox.value = '';
    this.oninput();
  }, errors => {
    // Failed to post at least one attachment
    this.$submit.setAttribute('aria-disabled', 'false');
    this.$status.textContent = 'Failed to post your attachments. Try again later.';
  }).then(() => {
    // The textbox should be focused anyway
    this.$textbox.setAttribute('aria-readonly', 'false');
    this.$textbox.focus();
  });
};