- [ ] fix list member email in share modal on todo list page
      the share modal shows the email of invited users as long as it's still an invite
      as soon as they are members only "Unknown User" is shown. I think this might be related to the query not following the link correctly
- [ ] fix invitedBy email field in invitation on invitation page
      this might be a similar issue as the one with the member emails. Invites only show 'Invited by: Unknown'. This is also a link to a user entity and thus might be related
- [ ] fix dark mode toggle 
      the toggle in the top right doesn't correctly switch the themes, even though changing system mode works
      the toggle only changes some text from dark to light
- [ ] mobile improvements
  - [ ] the drop down for the category in the quick add gets too large and is too long on the right side, thus destroying the layout
  - [ ] the buttons at the top are taking up too much screen real estate due to them having to be shown in multiple rows, perhaps a small 3 line symbol menu would be better here?
- [x] fix routing when compiling to static website (use client-side routing?)
      `/[slug]` routes are used to identify todo lists. This means that some client-side routing is needed here as we want to deploy the app as a static webapp
