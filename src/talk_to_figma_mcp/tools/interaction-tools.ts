import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../utils/websocket";

// Easing schema for transitions
const EasingSchema = z.discriminatedUnion("type", [
  // Standard easing types
  z.object({
    type: z.enum([
      "EASE_IN",
      "EASE_OUT",
      "EASE_IN_AND_OUT",
      "LINEAR",
      "EASE_IN_BACK",
      "EASE_OUT_BACK",
      "EASE_IN_AND_OUT_BACK",
      "GENTLE",
      "QUICK",
      "BOUNCY",
      "SLOW"
    ])
  }),
  // Custom cubic bezier
  z.object({
    type: z.literal("CUSTOM_CUBIC_BEZIER"),
    x1: z.number().min(0).max(1).describe("First control point X (0-1)"),
    y1: z.number().describe("First control point Y"),
    x2: z.number().min(0).max(1).describe("Second control point X (0-1)"),
    y2: z.number().describe("Second control point Y")
  }),
  // Custom spring
  z.object({
    type: z.literal("CUSTOM_SPRING"),
    mass: z.number().positive().describe("Mass of the spring"),
    stiffness: z.number().positive().describe("Stiffness of the spring"),
    damping: z.number().positive().describe("Damping coefficient"),
    initialVelocity: z.number().describe("Initial velocity")
  })
]);

// Simple transition schema (DISSOLVE, SMART_ANIMATE, SCROLL_ANIMATE)
const SimpleTransitionSchema = z.object({
  type: z.enum(["DISSOLVE", "SMART_ANIMATE", "SCROLL_ANIMATE"]).describe("Simple transition type"),
  easing: EasingSchema.describe("Easing function for the transition"),
  duration: z.number().positive().describe("Duration in milliseconds")
});

// Directional transition schema (MOVE_IN, MOVE_OUT, PUSH, SLIDE_IN, SLIDE_OUT)
const DirectionalTransitionSchema = z.object({
  type: z.enum(["MOVE_IN", "MOVE_OUT", "PUSH", "SLIDE_IN", "SLIDE_OUT"]).describe("Directional transition type"),
  direction: z.enum(["LEFT", "RIGHT", "TOP", "BOTTOM"]).describe("Direction of the transition"),
  matchLayers: z.boolean().describe("Whether to match layers for smart animate behavior"),
  easing: EasingSchema.describe("Easing function for the transition"),
  duration: z.number().positive().describe("Duration in milliseconds")
});

// Combined transition schema
const TransitionSchema = z.union([SimpleTransitionSchema, DirectionalTransitionSchema]);

// Trigger schemas based on Figma API
const TriggerSchema = z.discriminatedUnion("type", [
  // Simple triggers (no additional properties)
  z.object({
    type: z.enum(["ON_CLICK", "ON_DRAG", "ON_MEDIA_END"]).describe("Simple trigger type")
  }),
  // Hover and press triggers (revert when finished)
  z.object({
    type: z.enum(["ON_HOVER", "ON_PRESS"]).describe("Trigger type that reverts when finished")
  }),
  // After timeout trigger
  z.object({
    type: z.literal("AFTER_TIMEOUT"),
    timeout: z.number().positive().describe("Timeout in milliseconds before triggering")
  }),
  // Mouse up/down triggers (permanent, one-way navigation)
  z.object({
    type: z.enum(["MOUSE_UP", "MOUSE_DOWN"]),
    delay: z.number().min(0).describe("Delay in milliseconds before triggering")
  }),
  // Mouse enter/leave triggers (permanent navigation)
  z.object({
    type: z.enum(["MOUSE_ENTER", "MOUSE_LEAVE"]),
    delay: z.number().min(0).describe("Delay in milliseconds before triggering")
  }),
  // Keyboard trigger
  z.object({
    type: z.literal("ON_KEY_DOWN"),
    device: z.enum(["KEYBOARD", "XBOX_ONE", "PS4", "SWITCH_PRO", "UNKNOWN_CONTROLLER"]).describe("Input device type"),
    keyCodes: z.array(z.number()).describe("Array of key codes that trigger the action")
  }),
  // Media hit trigger (fires at specific video timestamp)
  z.object({
    type: z.literal("ON_MEDIA_HIT"),
    mediaHitTime: z.number().min(0).describe("Time in seconds when the trigger fires")
  })
]);

// Navigation action schema
const NavigationSchema = z.enum([
  "NAVIGATE",
  "SWAP",
  "OVERLAY",
  "SCROLL_TO",
  "CHANGE_TO",
  "BACK",
  "CLOSE",
  "URL",
  "NODE"
]).describe("Navigation type for the action");

// Action schema (simplified - the full action schema is complex)
const ActionSchema = z.object({
  type: NavigationSchema,
  destinationId: z.string().optional().describe("ID of the destination node"),
  url: z.string().optional().describe("URL for URL navigation"),
  transition: TransitionSchema.optional().describe("Transition to use for the navigation"),
  preserveScrollPosition: z.boolean().optional().describe("Whether to preserve scroll position"),
  overlayRelativePosition: z.object({
    x: z.number(),
    y: z.number()
  }).optional().describe("Position for overlay relative to trigger")
});

// Reaction schema (combines trigger + action)
const ReactionSchema = z.object({
  trigger: TriggerSchema.describe("The trigger that initiates the reaction"),
  action: ActionSchema.describe("The action to perform when triggered")
});

/**
 * Register interaction tools to the MCP server
 * This module contains tools for managing prototyping interactions (triggers, transitions, reactions)
 * @param server - The MCP server instance
 */
export function registerInteractionTools(server: McpServer): void {
  // Get Reactions Tool
  server.tool(
    "get_reactions",
    "Get all prototype reactions (interactions) from a node in Figma. Use this to see what click handlers, hover effects, tap interactions, navigation links, or animations are configured on a button, frame, or component. Reactions define triggers (ON_CLICK, ON_HOVER, ON_PRESS, ON_DRAG, AFTER_TIMEOUT, MOUSE_ENTER, MOUSE_LEAVE, ON_KEY_DOWN) and actions (navigate, overlay, swap, scroll to) with transitions (dissolve, smart animate, slide, push, move).",
    {
      nodeId: z.string().describe("The ID of the node to get reactions from")
    },
    async ({ nodeId }) => {
      try {
        const result = await sendCommandToFigma("get_reactions", { nodeId });
        const typedResult = result as { name: string; reactions: unknown[] };

        return {
          content: [
            {
              type: "text",
              text: `Retrieved ${typedResult.reactions?.length || 0} reaction(s) from node "${typedResult.name}":\n${JSON.stringify(typedResult.reactions, null, 2)}`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting reactions: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  // Set Reactions Tool
  server.tool(
    "set_reactions",
    "Set all prototype reactions (interactions) on a node in Figma, replacing existing ones. Use this to configure click handlers, hover effects, tap interactions, navigation links, button actions, or page transitions. Supports triggers: ON_CLICK (tap/click), ON_HOVER (mouse over), ON_PRESS (hold), ON_DRAG (swipe/drag), AFTER_TIMEOUT (delay/auto-advance), MOUSE_ENTER, MOUSE_LEAVE, ON_KEY_DOWN (keyboard). Supports actions: NAVIGATE (go to frame), OVERLAY (show popup/modal), SWAP, SCROLL_TO, BACK, CLOSE, URL (open link). Supports transitions: DISSOLVE (fade), SMART_ANIMATE, SLIDE_IN, SLIDE_OUT, PUSH, MOVE_IN, MOVE_OUT with directions LEFT, RIGHT, TOP, BOTTOM.",
    {
      nodeId: z.string().describe("The ID of the node to set reactions on"),
      reactions: z.array(ReactionSchema).describe("Array of reactions to set on the node")
    },
    async ({ nodeId, reactions }) => {
      try {
        const result = await sendCommandToFigma("set_reactions", { nodeId, reactions });
        const typedResult = result as { name: string; reactions: unknown[] };

        return {
          content: [
            {
              type: "text",
              text: `Set ${reactions.length} reaction(s) on node "${typedResult.name}"`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting reactions: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  // Add Reaction Tool
  server.tool(
    "add_reaction",
    "Add a prototype reaction (interaction) to a node in Figma without removing existing reactions. Use this to add a click handler, hover effect, tap action, navigation link, button behavior, or animation trigger to a button, frame, or component. Trigger types: ON_CLICK (tap/click a button), ON_HOVER (mouse over/hover state), ON_PRESS (hold/long press), ON_DRAG (swipe/drag gesture), AFTER_TIMEOUT (auto-advance after delay), MOUSE_ENTER, MOUSE_LEAVE, ON_KEY_DOWN (keyboard shortcut). Action types: NAVIGATE (go to page/frame), OVERLAY (show popup/modal/tooltip), SWAP (replace content), SCROLL_TO, BACK (go back), CLOSE (dismiss), URL (open external link). Transition types: DISSOLVE (fade in/out), SMART_ANIMATE (animate between states), SLIDE_IN, SLIDE_OUT, PUSH, MOVE_IN, MOVE_OUT with easing options.",
    {
      nodeId: z.string().describe("The ID of the node to add a reaction to"),
      trigger: TriggerSchema.describe("The trigger that initiates the reaction (e.g., ON_CLICK, ON_HOVER, AFTER_TIMEOUT)"),
      action: ActionSchema.describe("The action to perform when triggered")
    },
    async ({ nodeId, trigger, action }) => {
      try {
        const result = await sendCommandToFigma("add_reaction", { nodeId, trigger, action });
        const typedResult = result as { name: string; reactions: unknown[] };

        return {
          content: [
            {
              type: "text",
              text: `Added reaction with trigger "${trigger.type}" to node "${typedResult.name}". Total reactions: ${typedResult.reactions?.length || 0}`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error adding reaction: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  // Remove Reaction Tool
  server.tool(
    "remove_reaction",
    "Remove a prototype reaction (interaction) from a node by its index in Figma. Use this to delete a click handler, hover effect, navigation link, or animation trigger from a button or element.",
    {
      nodeId: z.string().describe("The ID of the node to remove a reaction from"),
      reactionIndex: z.number().int().min(0).describe("The index of the reaction to remove (0-based)")
    },
    async ({ nodeId, reactionIndex }) => {
      try {
        const result = await sendCommandToFigma("remove_reaction", { nodeId, reactionIndex });
        const typedResult = result as { name: string; reactions: unknown[] };

        return {
          content: [
            {
              type: "text",
              text: `Removed reaction at index ${reactionIndex} from node "${typedResult.name}". Remaining reactions: ${typedResult.reactions?.length || 0}`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error removing reaction: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  // Get Prototype Start Node Tool
  server.tool(
    "get_prototype_start_node",
    "Get the starting node (home screen, first frame, landing page) for prototype presentation in Figma. This is the initial frame that appears when the prototype is played or previewed. Use this to check which frame is set as the prototype entry point.",
    {},
    async () => {
      try {
        const result = await sendCommandToFigma("get_prototype_start_node", {});
        const typedResult = result as { startNodeId: string | null; startNodeName: string | null };

        if (typedResult.startNodeId) {
          return {
            content: [
              {
                type: "text",
                text: `Prototype start node: "${typedResult.startNodeName}" (ID: ${typedResult.startNodeId})`
              }
            ]
          };
        } else {
          return {
            content: [
              {
                type: "text",
                text: "No prototype start node is set for the current page."
              }
            ]
          };
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting prototype start node: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  // Set Prototype Start Node Tool
  server.tool(
    "set_prototype_start_node",
    "Set the starting node (home screen, first frame, landing page, entry point) for prototype presentation in Figma. This determines which frame appears first when the prototype is played, previewed, or shared. Use this to define the initial screen, splash page, or main menu of your prototype flow.",
    {
      nodeId: z.string().optional().describe("The ID of the node to set as the prototype start. Pass null or omit to clear the start node.")
    },
    async ({ nodeId }) => {
      try {
        const result = await sendCommandToFigma("set_prototype_start_node", { nodeId: nodeId || null });
        const typedResult = result as { success: boolean; startNodeId: string | null; startNodeName: string | null };

        if (typedResult.startNodeId) {
          return {
            content: [
              {
                type: "text",
                text: `Set prototype start node to "${typedResult.startNodeName}" (ID: ${typedResult.startNodeId})`
              }
            ]
          };
        } else {
          return {
            content: [
              {
                type: "text",
                text: "Cleared prototype start node."
              }
            ]
          };
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting prototype start node: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );
}
