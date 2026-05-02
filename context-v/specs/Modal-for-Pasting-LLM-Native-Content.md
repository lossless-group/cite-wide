

# Goal:

- **Prevent the need for Complex, Manual Parsing:** Eliminate the need for users to manually, or with modal, extract and format citations from LLM outputs. Stop the problem at it's source!

[[cite-wide/context-v/blueprints/Parse-Common-Citation-Formats.md]]

I want to create a modal that gives a big text area where I can paste LLM output, and select Google or Perplexsity. The modal sends to the same parsing logic used for the existing parsing functionality (which may need to be refactored to be used in both contexts).

Once the content is pasted, it will go through the parsing logic in the referenced file [[cite-wide/context-v/blueprints/Parse-Common-Citation-Formats.md]]. 

It will be pasted at the line the user launches the modal from, or the current cursor location -- available through the Obsidian API (read API docs for call, or find it in one of our many modals and functions and commands that uses it).


The output should be formatted accoring to our spec: [[cite-wide/context-v/reminders/Lossless-Citation-Spec.md]]